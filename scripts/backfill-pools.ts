/**
 * Backfill script:
 *   1. Fix transactions with base_amount=0
 *   2. Seed transactions for pools missing data
 *   3. Seed events for pools missing data
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2";

const DB_CONFIG = {
  host: process.env.TIDB_HOST,
  port: Number(process.env.TIDB_PORT || "4000"),
  user: process.env.TIDB_USER,
  password: process.env.TIDB_PASSWORD,
  database: process.env.TIDB_DATABASE || "chainscope",
  waitForConnections: true,
  connectionLimit: 5,
  ssl: { rejectUnauthorized: true },
};

const BATCH_SIZE = 2000;
const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function randomBase58(len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
function formatCompact(n: number): string {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

interface Pool {
  address: string;
  token_base_symbol: string;
  token_quote_symbol: string;
  dex: string;
  price_usd: number;
  volume_24h: number;
  liquidity_usd: number;
}

async function main() {
  const db = await mysql.createPool(DB_CONFIG);
  console.log("Connected to TiDB.\n");

  // ── Step 1: Fix base_amount=0 ──────────────────────────────────
  console.log("Step 1: Fixing transactions with base_amount=0...");
  const [zeroRows] = await db.query<RowDataPacket[]>(`
    SELECT t.id, t.usd_value, t.pool_address, p.price_usd
    FROM swap_transactions t
    JOIN pools p ON t.pool_address = p.address
    WHERE t.base_amount = 0
  `);
  console.log(`  Found ${zeroRows.length} transactions with base_amount=0`);

  let fixedCount = 0;
  const fixBatch: [number, number][] = [];
  for (const row of zeroRows) {
    const price = Number(row.price_usd);
    const usd = Number(row.usd_value);
    let baseAmount = price > 0 ? usd / price : usd * (0.5 + Math.random());
    baseAmount = Math.min(baseAmount, 99_999_999_999_999);
    baseAmount = Math.round(baseAmount * 1_000_000) / 1_000_000;
    fixBatch.push([baseAmount, row.id]);
  }

  // Batch update
  for (let i = 0; i < fixBatch.length; i += 500) {
    const chunk = fixBatch.slice(i, i + 500);
    const cases = chunk.map(([amt, id]) => `WHEN ${id} THEN ${amt}`).join(" ");
    const ids = chunk.map(([, id]) => id).join(",");
    await db.execute(`UPDATE swap_transactions SET base_amount = CASE id ${cases} END WHERE id IN (${ids})`);
    fixedCount += chunk.length;
    if (fixedCount % 1000 === 0 || fixedCount === fixBatch.length) {
      console.log(`  Fixed ${fixedCount}/${fixBatch.length}`);
    }
  }
  console.log(`  Done: fixed ${fixedCount} transactions.\n`);

  // ── Step 2: Get pools missing data ────────────────────────────
  const [missingPools] = await db.query<(Pool & RowDataPacket)[]>(`
    SELECT p.address, p.token_base_symbol, p.token_quote_symbol, p.dex,
           p.price_usd, p.volume_24h, p.liquidity_usd
    FROM pools p
    LEFT JOIN (SELECT DISTINCT pool_address FROM swap_transactions) t ON p.address = t.pool_address
    WHERE t.pool_address IS NULL
    ORDER BY p.volume_24h DESC
  `);
  console.log(`Step 2: Seeding transactions for ${missingPools.length} pools...`);

  // ── Step 3: Generate transactions for each missing pool ───────
  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  let totalTx = 0;
  let txBatch: unknown[][] = [];

  for (const pool of missingPools) {
    const vol24h = Number(pool.volume_24h) || 100;
    const price = Number(pool.price_usd) || 0.001;

    // Scale tx count by volume: more volume = more transactions
    let txCount: number;
    if (vol24h >= 1_000_000) txCount = 800 + Math.floor(Math.random() * 400);
    else if (vol24h >= 100_000) txCount = 300 + Math.floor(Math.random() * 200);
    else if (vol24h >= 10_000) txCount = 100 + Math.floor(Math.random() * 100);
    else if (vol24h >= 1_000) txCount = 30 + Math.floor(Math.random() * 40);
    else txCount = 10 + Math.floor(Math.random() * 15);

    for (let i = 0; i < txCount; i++) {
      // Bias timestamps toward recent
      const recencyBias = Math.pow(Math.random(), 0.6);
      const timestamp = now - Math.floor(recencyBias * sevenDaysMs);

      // Trade size: log-normal, scaled to pool volume
      const avgTradeSize = vol24h / Math.max(txCount, 1);
      let usdValue = avgTradeSize * Math.exp((Math.random() - 0.5) * 2.5);
      usdValue = Math.max(1, Math.round(usdValue * 100) / 100);

      const isBuy = Math.random() < 0.5;
      let baseAmount = price > 0 ? usdValue / price : usdValue;
      baseAmount = Math.min(baseAmount, 99_999_999_999_999);
      baseAmount = Math.round(baseAmount * 1_000_000) / 1_000_000;

      txBatch.push([
        randomBase58(88), timestamp, pool.address, pool.dex,
        isBuy ? "buy" : "sell", baseAmount, usdValue, usdValue,
        randomBase58(44),
      ]);

      if (txBatch.length >= BATCH_SIZE) {
        const ph = txBatch.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?)").join(",");
        await db.execute(
          `INSERT INTO swap_transactions (signature, timestamp, pool_address, dex, side, base_amount, quote_amount, usd_value, trader_wallet) VALUES ${ph}`,
          txBatch.flat()
        );
        totalTx += txBatch.length;
        txBatch = [];
        process.stdout.write(`\r  Inserted ${totalTx.toLocaleString()} transactions...`);
      }
    }
  }

  // Flush remaining
  if (txBatch.length > 0) {
    const ph = txBatch.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?)").join(",");
    await db.execute(
      `INSERT INTO swap_transactions (signature, timestamp, pool_address, dex, side, base_amount, quote_amount, usd_value, trader_wallet) VALUES ${ph}`,
      txBatch.flat()
    );
    totalTx += txBatch.length;
  }
  console.log(`\n  Done: inserted ${totalTx.toLocaleString()} transactions.\n`);

  // ── Step 4: Generate events for each missing pool ─────────────
  console.log(`Step 3: Seeding events for ${missingPools.length} pools...`);

  const eventTypes = [
    { type: "swap", severity: "low", template: (p: Pool, usd: number) =>
      `${Math.random() < 0.5 ? "bought" : "sold"} ${formatCompact(usd)} ${p.token_base_symbol} via ${p.dex}` },
    { type: "whale", severity: "high", template: (p: Pool, usd: number) =>
      `whale ${Math.random() < 0.5 ? "bought" : "sold"} ${formatCompact(usd)} ${p.token_base_symbol} via ${p.dex}` },
    { type: "large_trade", severity: "medium", template: (p: Pool, usd: number) =>
      `Large trade on ${p.token_base_symbol}/${p.token_quote_symbol}: ${formatCompact(usd)} volume` },
    { type: "smart_money", severity: "high", template: (p: Pool, usd: number) =>
      `Smart money ${Math.random() < 0.5 ? "bought" : "sold"} ${formatCompact(usd)} ${p.token_base_symbol}` },
    { type: "liquidity_add", severity: "medium", template: (p: Pool, usd: number) =>
      `${formatCompact(usd)} liquidity added to ${p.token_base_symbol}/${p.token_quote_symbol}` },
    { type: "liquidity_remove", severity: "medium", template: (p: Pool, usd: number) =>
      `${formatCompact(usd)} liquidity removed from ${p.token_base_symbol}/${p.token_quote_symbol}` },
    { type: "new_pool", severity: "high", template: (p: Pool, usd: number) =>
      `New ${p.token_base_symbol}/${p.token_quote_symbol} pool created on ${p.dex} with ${formatCompact(usd)} liquidity` },
  ];

  let totalEv = 0;
  let evBatch: unknown[][] = [];

  for (const pool of missingPools) {
    const vol24h = Number(pool.volume_24h) || 100;
    const liq = Number(pool.liquidity_usd) || 1000;

    // Scale event count by volume
    let evCount: number;
    if (vol24h >= 1_000_000) evCount = 30 + Math.floor(Math.random() * 20);
    else if (vol24h >= 100_000) evCount = 15 + Math.floor(Math.random() * 10);
    else if (vol24h >= 10_000) evCount = 8 + Math.floor(Math.random() * 7);
    else evCount = 3 + Math.floor(Math.random() * 5);

    for (let i = 0; i < evCount; i++) {
      const recencyBias = Math.pow(Math.random(), 0.5);
      const timestamp = now - Math.floor(recencyBias * sevenDaysMs);

      // Pick event type based on volume
      let evType;
      const r = Math.random();
      if (r < 0.05) evType = eventTypes[6]; // new_pool (rare)
      else if (r < 0.15) evType = eventTypes[1]; // whale
      else if (r < 0.25) evType = eventTypes[3]; // smart_money
      else if (r < 0.40) evType = eventTypes[2]; // large_trade
      else if (r < 0.50) evType = eventTypes[4]; // liquidity_add
      else if (r < 0.60) evType = eventTypes[5]; // liquidity_remove
      else evType = eventTypes[0]; // swap

      // USD value: scaled to pool volume
      let usdValue: number;
      if (evType.type === "whale") usdValue = 10_000 + Math.random() * vol24h * 0.1;
      else if (evType.type === "smart_money") usdValue = 5_000 + Math.random() * vol24h * 0.05;
      else if (evType.type === "new_pool") usdValue = liq;
      else if (evType.type.startsWith("liquidity")) usdValue = 1_000 + Math.random() * liq * 0.3;
      else usdValue = 100 + Math.random() * vol24h * 0.01;
      usdValue = Math.round(usdValue * 100) / 100;

      const desc = evType.template(pool, usdValue);

      evBatch.push([
        evType.type, timestamp, pool.address, pool.dex,
        evType.severity, randomBase58(44), usdValue, desc,
      ]);

      if (evBatch.length >= BATCH_SIZE) {
        const ph = evBatch.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(",");
        await db.execute(
          `INSERT INTO defi_events (event_type, timestamp, pool_address, dex, severity, trader_wallet, usd_value, description) VALUES ${ph}`,
          evBatch.flat()
        );
        totalEv += evBatch.length;
        evBatch = [];
        process.stdout.write(`\r  Inserted ${totalEv.toLocaleString()} events...`);
      }
    }
  }

  if (evBatch.length > 0) {
    const ph = evBatch.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(",");
    await db.execute(
      `INSERT INTO defi_events (event_type, timestamp, pool_address, dex, severity, trader_wallet, usd_value, description) VALUES ${ph}`,
      evBatch.flat()
    );
    totalEv += evBatch.length;
  }
  console.log(`\n  Done: inserted ${totalEv.toLocaleString()} events.\n`);

  // ── Step 5: Verify ────────────────────────────────────────────
  console.log("Step 4: Verifying...");
  const [poolCount] = await db.query<RowDataPacket[]>("SELECT COUNT(*) as cnt FROM pools");
  const [txPoolCount] = await db.query<RowDataPacket[]>("SELECT COUNT(DISTINCT pool_address) as cnt FROM swap_transactions");
  const [evPoolCount] = await db.query<RowDataPacket[]>("SELECT COUNT(DISTINCT pool_address) as cnt FROM defi_events");
  const [zeroBase] = await db.query<RowDataPacket[]>("SELECT COUNT(*) as cnt FROM swap_transactions WHERE base_amount = 0");
  const [totalTxCount] = await db.query<RowDataPacket[]>("SELECT COUNT(*) as cnt FROM swap_transactions");
  const [totalEvCount] = await db.query<RowDataPacket[]>("SELECT COUNT(*) as cnt FROM defi_events");

  console.log(`  Pools: ${poolCount[0].cnt}`);
  console.log(`  Pools with transactions: ${txPoolCount[0].cnt}`);
  console.log(`  Pools with events: ${evPoolCount[0].cnt}`);
  console.log(`  Total transactions: ${totalTxCount[0].cnt}`);
  console.log(`  Total events: ${totalEvCount[0].cnt}`);
  console.log(`  Transactions with base_amount=0: ${zeroBase[0].cnt}`);

  await db.end();
  console.log("\nDone!");
}

main().catch(console.error);
