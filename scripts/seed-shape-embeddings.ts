/**
 * Seed pattern_shape_embeddings using OHLCV data from GeckoTerminal.
 *
 * Fetches 1h candles for each pool, z-normalizes the close prices,
 * and PAA-downsamples to 32 dims. The result is a vector that captures
 * the VISUAL SHAPE of the chart — two tokens with similar-looking charts
 * will have near-identical embeddings.
 *
 * Rate limit: GeckoTerminal allows 30 req/min.
 * Strategy: fetch in batches of 28, then wait 62s.
 *
 * Run: NODE_TLS_REJECT_UNAUTHORIZED=0 npx tsx scripts/seed-shape-embeddings.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import mysql from "mysql2/promise";

const GECKO_BASE = "https://api.geckoterminal.com/api/v2";
const BATCH_SIZE = 28; // stay under 30/min rate limit
const WAIT_MS = 62_000; // wait between batches

// ─── Embedding logic ─────────────────────────────────────────────────

function paa(series: number[], targetLen: number): number[] {
  const n = series.length;
  if (n === 0) return new Array(targetLen).fill(0);
  if (n <= targetLen) {
    const result = [...series];
    while (result.length < targetLen) result.push(series[series.length - 1]);
    return result;
  }
  const segLen = n / targetLen;
  const result: number[] = [];
  for (let i = 0; i < targetLen; i++) {
    const start = Math.floor(i * segLen);
    const end = Math.floor((i + 1) * segLen);
    let sum = 0;
    for (let j = start; j < end; j++) sum += series[j];
    result.push(sum / (end - start));
  }
  return result;
}

function zNormalize(series: number[]): number[] {
  const n = series.length;
  if (n === 0) return [];
  const mean = series.reduce((a, b) => a + b, 0) / n;
  const std = Math.sqrt(series.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  if (std < 1e-10) return series.map(() => 0);
  return series.map((v) => (v - mean) / std);
}

function generateShapeEmbedding(closes: number[]): number[] {
  if (closes.length < 4) return new Array(32).fill(0);
  const normalized = zNormalize(closes);
  const embedding = paa(normalized, 32);
  const norm = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0));
  if (norm < 1e-10) return embedding;
  return embedding.map((v) => v / norm);
}

// ─── GeckoTerminal fetch ─────────────────────────────────────────────

async function fetchOHLCV(poolAddress: string): Promise<number[]> {
  const url =
    `${GECKO_BASE}/networks/solana/pools/${poolAddress}` +
    `/ohlcv/hour?aggregate=1&limit=48&currency=usd`;

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return [];
    const json = await res.json();
    const list: number[][] = json?.data?.attributes?.ohlcv_list ?? [];
    // GeckoTerminal returns [ts, o, h, l, close, vol] newest-first
    return list.reverse().map((c) => c[4]); // close prices, oldest-first
  } catch {
    return [];
  }
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.TIDB_HOST!,
    port: Number(process.env.TIDB_PORT || 4000),
    user: process.env.TIDB_USER!,
    password: process.env.TIDB_PASSWORD || "",
    database: process.env.TIDB_DATABASE || "chainscope",
    ssl: { minVersion: "TLSv1.2", rejectUnauthorized: false },
  });

  console.log("Connected. Fetching pool list...\n");

  // Get top pools by volume
  const [rows] = await conn.query<mysql.RowDataPacket[]>(`
    SELECT address, token_base_symbol, token_quote_symbol, dex,
           volume_24h, liquidity_usd, price_usd, price_change_24h
    FROM pools
    WHERE volume_24h > 1000
    ORDER BY volume_24h DESC
    LIMIT 500
  `);

  console.log(`Found ${rows.length} pools. Starting OHLCV fetch...\n`);
  console.log(`Rate limit: ${BATCH_SIZE} pools per ${WAIT_MS / 1000}s\n`);

  let seeded = 0;
  let skipped = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(rows.length / BATCH_SIZE);

    console.log(`Batch ${batchNum}/${totalBatches} (pools ${i + 1}-${i + batch.length})...`);

    // Fetch OHLCV for all pools in this batch (parallel within batch)
    const results = await Promise.all(
      batch.map(async (pool) => {
        const closes = await fetchOHLCV(pool.address);
        return { pool, closes };
      })
    );

    // Generate embeddings and insert
    for (const { pool, closes } of results) {
      if (closes.length < 8) {
        skipped++;
        continue;
      }

      const embedding = generateShapeEmbedding(closes);
      const embStr = `[${embedding.join(",")}]`;

      try {
        await conn.query(
          `INSERT INTO pattern_shape_embeddings
            (pool_address, token_base_symbol, token_quote_symbol, pair_name,
             dex, embedding, volume_24h, liquidity_usd, price_usd,
             price_change_24h, candle_count)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             embedding = VALUES(embedding),
             volume_24h = VALUES(volume_24h),
             liquidity_usd = VALUES(liquidity_usd),
             price_usd = VALUES(price_usd),
             price_change_24h = VALUES(price_change_24h),
             candle_count = VALUES(candle_count),
             updated_at = NOW()`,
          [
            pool.address,
            pool.token_base_symbol || "",
            pool.token_quote_symbol || "",
            `${pool.token_base_symbol || "?"}/${pool.token_quote_symbol || "?"}`,
            pool.dex,
            embStr,
            Number(pool.volume_24h ?? 0),
            Number(pool.liquidity_usd ?? 0),
            Number(pool.price_usd ?? 0),
            Math.max(-999999, Math.min(999999, Number(pool.price_change_24h ?? 0))),
            closes.length,
          ]
        );
        seeded++;
      } catch (err) {
        console.error(`  Error for ${pool.address}:`, (err as Error).message.substring(0, 80));
        skipped++;
      }
    }

    console.log(`  Seeded: ${seeded} | Skipped: ${skipped}`);

    // Rate limit: wait before next batch (skip wait on last batch)
    if (i + BATCH_SIZE < rows.length) {
      process.stdout.write(`  Waiting ${WAIT_MS / 1000}s for rate limit...`);
      await new Promise((r) => setTimeout(r, WAIT_MS));
      console.log(" done");
    }
  }

  console.log(`\nComplete! Seeded: ${seeded}, Skipped: ${skipped}`);

  // Verify with a test query
  const [[{ c }]] = await conn.query<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) as c FROM pattern_shape_embeddings"
  );
  console.log(`Total rows in pattern_shape_embeddings: ${c}`);

  if (Number(c) > 1) {
    const [test] = await conn.query<mysql.RowDataPacket[]>(`
      SELECT pe.pool_address, pe.pair_name, pe.dex,
        (1 - VEC_COSINE_DISTANCE(pe.embedding, (
          SELECT embedding FROM pattern_shape_embeddings ORDER BY volume_24h DESC LIMIT 1
        ))) AS similarity
      FROM pattern_shape_embeddings pe
      ORDER BY similarity DESC
      LIMIT 5
    `);
    console.log("\nShape similarity test (top-5 similar to highest-volume pool):");
    for (const r of test) {
      console.log(`  ${r.pair_name} (${r.dex}) — ${(Number(r.similarity) * 100).toFixed(1)}%`);
    }
  }

  await conn.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
