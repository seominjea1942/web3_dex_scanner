/**
 * Seed pattern_shape_embeddings from swap_transactions in TiDB.
 * No external API needed — generates OHLCV candles directly from swap data.
 *
 * Run: NODE_TLS_REJECT_UNAUTHORIZED=0 npx tsx scripts/seed-shape-from-swaps.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import mysql from "mysql2/promise";

const BATCH_SIZE = 50;
const MIN_CANDLES = 8; // need at least 8 candles for meaningful shape
const BUCKET_MS = 3600000; // 1h candles (in ms)
const BUCKET_SEC = 3600; // 1h candles (in sec)

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

function generateShapeEmbedding(closes: number[]): number[] | null {
  if (closes.length < MIN_CANDLES) return null;
  const normalized = zNormalize(closes);
  const embedding = paa(normalized, 32);
  const norm = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0));
  if (norm < 1e-10) return null; // flat line
  return embedding.map((v) => v / norm);
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

  console.log("Connected. Fetching pools with swap data...\n");

  // Get all pools that have swap data + pool metadata
  const [pools] = await conn.query<mysql.RowDataPacket[]>(`
    SELECT
      p.address, p.token_base_symbol, p.token_quote_symbol, p.dex,
      p.price_usd, p.volume_24h, p.liquidity_usd, p.price_change_24h
    FROM pools p
    WHERE p.address IN (SELECT DISTINCT pool_address FROM swap_transactions)
    ORDER BY p.volume_24h DESC
  `);

  console.log(`Found ${pools.length} pools with swap data.\n`);

  let seeded = 0;
  let skipped = 0;
  let updated = 0;

  for (let i = 0; i < pools.length; i += BATCH_SIZE) {
    const batch = pools.slice(i, i + BATCH_SIZE);
    process.stdout.write(`\rProcessing ${i + 1}-${Math.min(i + BATCH_SIZE, pools.length)} of ${pools.length}...`);

    for (const pool of batch) {
      // Generate OHLCV from swap_transactions using median-price filter
      // (same logic as the OHLCV API fallback)
      const [stats] = await conn.query<mysql.RowDataPacket[]>(
        `SELECT AVG(price) AS median_price
         FROM (
           SELECT usd_value / base_amount AS price,
                  ROW_NUMBER() OVER (ORDER BY usd_value / base_amount) AS rn,
                  COUNT(*) OVER () AS total
           FROM swap_transactions
           WHERE pool_address = ? AND base_amount > 0 AND usd_value > 0
         ) ranked
         WHERE rn BETWEEN total * 0.25 AND total * 0.75`,
        [pool.address]
      );

      const medianPrice = Number(stats[0]?.median_price) || 0;
      if (medianPrice <= 0) { skipped++; continue; }

      const lower = medianPrice * 0.4;
      const upper = medianPrice * 2.5;

      const [candles] = await conn.query<mysql.RowDataPacket[]>(
        `SELECT
           FLOOR(timestamp / ?) * ? AS bucket_time,
           SUBSTRING_INDEX(GROUP_CONCAT(price ORDER BY timestamp ASC), ',', 1) + 0 AS open_price,
           MAX(price) AS high,
           MIN(price) AS low,
           SUBSTRING_INDEX(GROUP_CONCAT(price ORDER BY timestamp DESC), ',', 1) + 0 AS close_price,
           SUM(usd_value) AS volume
         FROM (
           SELECT timestamp, usd_value, usd_value / base_amount AS price
           FROM swap_transactions
           WHERE pool_address = ? AND base_amount > 0 AND usd_value > 0
             AND usd_value / base_amount BETWEEN ? AND ?
         ) filtered
         GROUP BY bucket_time
         ORDER BY bucket_time ASC`,
        [BUCKET_MS, BUCKET_SEC, pool.address, lower, upper]
      );

      // Smooth: connect each candle's open to previous close
      const closes: number[] = [];
      let prevClose = 0;
      for (const c of candles) {
        const close = Number(c.close_price);
        if (prevClose > 0) {
          // Use smoothed close
          closes.push(close);
        } else {
          closes.push(close);
        }
        prevClose = close;
      }

      const embedding = generateShapeEmbedding(closes);
      if (!embedding) { skipped++; continue; }

      const embStr = `[${embedding.join(",")}]`;

      try {
        await conn.query(
          `INSERT INTO pattern_shape_embeddings
            (pool_address, token_base_symbol, token_quote_symbol, pair_name,
             dex, embedding, volume_24h, liquidity_usd, price_usd,
             price_change_24h, ohlcv_source, candle_count)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'tidb_swaps', ?)
           ON DUPLICATE KEY UPDATE
             embedding = VALUES(embedding),
             volume_24h = VALUES(volume_24h),
             liquidity_usd = VALUES(liquidity_usd),
             price_usd = VALUES(price_usd),
             price_change_24h = VALUES(price_change_24h),
             ohlcv_source = 'tidb_swaps',
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
        console.error(`\n  Error: ${pool.address}:`, (err as Error).message.substring(0, 80));
        skipped++;
      }
    }
  }

  console.log(`\n\nDone! Seeded: ${seeded}, Skipped: ${skipped}, Updated: ${updated}`);

  const [[{ c }]] = await conn.query<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) as c FROM pattern_shape_embeddings"
  );
  console.log(`Total rows in pattern_shape_embeddings: ${c}`);

  // Test
  if (Number(c) > 5) {
    const [test] = await conn.query<mysql.RowDataPacket[]>(`
      SELECT pe.pair_name, pe.dex, pe.ohlcv_source, pe.candle_count,
        (1 - VEC_COSINE_DISTANCE(pe.embedding, (
          SELECT embedding FROM pattern_shape_embeddings ORDER BY volume_24h DESC LIMIT 1
        ))) AS similarity
      FROM pattern_shape_embeddings pe
      ORDER BY similarity DESC LIMIT 5
    `);
    console.log("\nTop-5 shape similarity test:");
    for (const r of test) {
      console.log(`  ${r.pair_name} (${r.dex}) — ${(Number(r.similarity) * 100).toFixed(1)}% [${r.candle_count} candles, ${r.ohlcv_source}]`);
    }
  }

  await conn.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
