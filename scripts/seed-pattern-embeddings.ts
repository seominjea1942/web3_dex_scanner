/**
 * Seed pattern_embeddings from existing pools table.
 * Run: npx tsx scripts/seed-pattern-embeddings.ts
 *
 * Safe: only INSERTs into the new pattern_embeddings table.
 * Does NOT modify any existing tables.
 */

import { config } from "dotenv";
config({ path: ".env.local" });
import mysql from "mysql2/promise";
import { generatePatternEmbedding, type PoolMetrics } from "../lib/pattern-embedding";

const BATCH_SIZE = 100;

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.TIDB_HOST!,
    port: Number(process.env.TIDB_PORT || 4000),
    user: process.env.TIDB_USER!,
    password: process.env.TIDB_PASSWORD || "",
    database: process.env.TIDB_DATABASE || "chainscope",
    ssl: { minVersion: "TLSv1.2", rejectUnauthorized: false },
  });

  console.log("Connected to TiDB. Fetching pools...\n");

  // Fetch all pools with their metrics
  const [rows] = await conn.query<mysql.RowDataPacket[]>(`
    SELECT
      p.address,
      p.token_base_address,
      p.token_base_symbol,
      p.token_quote_symbol,
      p.dex,
      p.price_usd,
      p.volume_5m, p.volume_1h, p.volume_6h, p.volume_24h,
      p.liquidity_usd, p.market_cap,
      p.price_change_5m, p.price_change_1h, p.price_change_6h, p.price_change_24h,
      p.txns_5m_buys, p.txns_5m_sells,
      p.txns_1h_buys, p.txns_1h_sells,
      p.txns_24h_buys, p.txns_24h_sells
    FROM pools p
    WHERE p.volume_24h > 0
    ORDER BY p.volume_24h DESC
  `);

  console.log(`Found ${rows.length} pools with volume > 0\n`);

  let inserted = 0;
  let skipped = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const values: string[] = [];
    const params: unknown[] = [];

    for (const row of batch) {
      const metrics: PoolMetrics = {
        volume_5m: Number(row.volume_5m ?? 0),
        volume_1h: Number(row.volume_1h ?? 0),
        volume_6h: Number(row.volume_6h ?? 0),
        volume_24h: Number(row.volume_24h ?? 0),
        price_change_5m: Number(row.price_change_5m ?? 0),
        price_change_1h: Number(row.price_change_1h ?? 0),
        price_change_6h: Number(row.price_change_6h ?? 0),
        price_change_24h: Number(row.price_change_24h ?? 0),
        txns_5m_buys: Number(row.txns_5m_buys ?? 0),
        txns_5m_sells: Number(row.txns_5m_sells ?? 0),
        txns_1h_buys: Number(row.txns_1h_buys ?? 0),
        txns_1h_sells: Number(row.txns_1h_sells ?? 0),
        txns_24h_buys: Number(row.txns_24h_buys ?? 0),
        txns_24h_sells: Number(row.txns_24h_sells ?? 0),
        liquidity_usd: Number(row.liquidity_usd ?? 0),
        market_cap: Number(row.market_cap ?? 0),
        price_usd: Number(row.price_usd ?? 0),
      };

      const embedding = generatePatternEmbedding(metrics);
      const embeddingStr = `[${embedding.join(",")}]`;

      values.push("(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      params.push(
        row.address,
        row.token_base_address,
        row.token_base_symbol || "",
        row.token_quote_symbol || "",
        `${row.token_base_symbol || "?"}/${row.token_quote_symbol || "?"}`,
        row.dex,
        embeddingStr,
        Number(row.volume_24h ?? 0),
        Number(row.liquidity_usd ?? 0),
        Number(row.market_cap ?? 0),
        Number(row.price_usd ?? 0),
        Math.max(-999999, Math.min(999999, Number(row.price_change_1h ?? 0))),
        Math.max(-999999, Math.min(999999, Number(row.price_change_6h ?? 0))),
        Math.max(-999999, Math.min(999999, Number(row.price_change_24h ?? 0))),
      );
    }

    if (values.length === 0) continue;

    try {
      const result = await conn.query(
        `INSERT INTO pattern_embeddings
          (pool_address, token_base_address, token_base_symbol, token_quote_symbol,
           pair_name, dex, embedding, volume_24h, liquidity_usd, market_cap,
           price_usd, price_change_1h, price_change_6h, price_change_24h)
         VALUES ${values.join(", ")}
         ON DUPLICATE KEY UPDATE
           embedding = VALUES(embedding),
           volume_24h = VALUES(volume_24h),
           liquidity_usd = VALUES(liquidity_usd),
           market_cap = VALUES(market_cap),
           price_usd = VALUES(price_usd),
           price_change_1h = VALUES(price_change_1h),
           price_change_6h = VALUES(price_change_6h),
           price_change_24h = VALUES(price_change_24h),
           embedding_updated_at = NOW()`,
        params
      );
      inserted += batch.length;
      process.stdout.write(`\r  Processed: ${inserted}/${rows.length}`);
    } catch (err) {
      console.error(`\n  Error at batch ${i}:`, (err as Error).message);
      skipped += batch.length;
    }
  }

  console.log(`\n\nDone! Inserted: ${inserted}, Skipped: ${skipped}`);

  // Verify
  const [[{ c }]] = await conn.query<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) as c FROM pattern_embeddings"
  );
  console.log(`Total rows in pattern_embeddings: ${c}`);

  // Test vector search
  const [testResults] = await conn.query<mysql.RowDataPacket[]>(`
    SELECT pe.pool_address, pe.pair_name, pe.dex, pe.volume_24h,
      (1 - VEC_COSINE_DISTANCE(pe.embedding, (
        SELECT embedding FROM pattern_embeddings ORDER BY volume_24h DESC LIMIT 1
      ))) AS similarity
    FROM pattern_embeddings pe
    ORDER BY similarity DESC
    LIMIT 5
  `);
  console.log("\nVector search test (top-5 similar to highest-volume pool):");
  for (const r of testResults) {
    console.log(`  ${r.pair_name} (${r.dex}) — ${(Number(r.similarity) * 100).toFixed(1)}% similar`);
  }

  await conn.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
