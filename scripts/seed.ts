import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { getPool } from "../lib/db";
import { fetchTopTokens } from "../lib/jupiter";
import { fetchPoolsForTokens, type DexScreenerPair } from "../lib/dexscreener";
import {
  fetchHeliusEvents,
  generateSyntheticTemplates,
} from "../lib/helius";
import * as fs from "fs";
import * as path from "path";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const pool = getPool();

  console.log("=== CHAINSCOPE Seed Script ===\n");

  // Phase 1: Create tables
  console.log("Phase 1: Creating tables...");
  const schemaPath = path.join(__dirname, "..", "db", "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf-8");
  const statements = schema
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    await pool.execute(stmt);
  }
  console.log("  Tables created.\n");

  // Phase 2: Seed tokens
  console.log("Phase 2: Seeding tokens...");
  const jupiterTokens = await fetchTopTokens(100);

  let tokenCount = 0;
  for (const t of jupiterTokens) {
    try {
      await pool.execute(
        `INSERT INTO tokens (id, symbol, name, logo_url) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE symbol = VALUES(symbol), name = VALUES(name), logo_url = VALUES(logo_url)`,
        [t.address, t.symbol, t.name, t.logoURI || null]
      );
      tokenCount++;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`  Skipping token ${t.symbol}: ${msg}`);
    }
  }
  console.log(`  Seeded ${tokenCount} tokens.\n`);

  // Phase 3: Seed pools from DexScreener
  console.log("Phase 3: Seeding pools...");
  const tokenAddresses = jupiterTokens.map((t) => t.address);
  const dexPairs = await fetchPoolsForTokens(tokenAddresses, 1200);

  let poolCount = 0;
  for (const pair of dexPairs) {
    try {
      await insertPool(pool, pair);
      poolCount++;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("Duplicate")) {
        console.warn(`  Pool insert error: ${msg}`);
      }
    }
  }
  console.log(`  Seeded ${poolCount} pools.\n`);

  // Phase 4: Seed event templates
  console.log("Phase 4: Seeding event templates...");
  const heliusKey = process.env.HELIUS_API_KEY;
  let templates;

  if (heliusKey) {
    console.log("  Using Helius API for real events...");
    try {
      templates = await fetchHeliusEvents(heliusKey);
    } catch (e) {
      console.warn("  Helius fetch failed, using synthetic templates");
      templates = generateSyntheticTemplates();
    }
  } else {
    console.log("  No HELIUS_API_KEY found, using synthetic templates...");
    templates = generateSyntheticTemplates();
  }

  // Enrich templates with logo URLs from tokens table
  for (const tmpl of templates) {
    const [rows] = await pool.query<Array<{ logo_url: string } & import("mysql2").RowDataPacket>>(
      `SELECT logo_url FROM tokens WHERE symbol = ? LIMIT 1`,
      [tmpl.token_symbol]
    );
    if (rows.length > 0 && rows[0].logo_url) {
      tmpl.token_logo_url = rows[0].logo_url;
    }
  }

  let templateCount = 0;
  for (const t of templates) {
    await pool.execute(
      `INSERT INTO event_templates (event_type, token_symbol, token_logo_url, description_template, wallet_address, amount_usd, dex_name, tx_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        t.event_type,
        t.token_symbol,
        t.token_logo_url,
        t.description_template,
        t.wallet_address,
        t.amount_usd,
        t.dex_name,
        t.tx_hash,
      ]
    );
    templateCount++;
  }
  console.log(`  Seeded ${templateCount} event templates.\n`);

  // Phase 5: Generate synthetic transactions (1M+ rows)
  console.log("Phase 5: Generating 1M+ synthetic transactions...");
  await generateTransactions(pool, dexPairs);
  console.log("");

  // Phase 6: Generate initial defi_events for past 24h
  console.log("Phase 6: Generating initial defi_events (past 24h)...");
  await generateInitialEvents(pool, templates);
  console.log("");

  // Phase 7: Seed performance metrics (1 hour at 5s intervals)
  console.log("Phase 7: Seeding performance metrics...");
  await seedPerformanceMetrics(pool);
  console.log("");

  // Print summary
  const [tokenRows] = await pool.query<Array<{ c: number } & import("mysql2").RowDataPacket>>(
    "SELECT COUNT(*) as c FROM tokens"
  );
  const [poolRows] = await pool.query<Array<{ c: number } & import("mysql2").RowDataPacket>>(
    "SELECT COUNT(*) as c FROM pools"
  );
  const [txRows] = await pool.query<Array<{ c: number } & import("mysql2").RowDataPacket>>(
    "SELECT COUNT(*) as c FROM transactions"
  );
  const [eventRows] = await pool.query<Array<{ c: number } & import("mysql2").RowDataPacket>>(
    "SELECT COUNT(*) as c FROM defi_events"
  );
  const [tmplRows] = await pool.query<Array<{ c: number } & import("mysql2").RowDataPacket>>(
    "SELECT COUNT(*) as c FROM event_templates"
  );
  const [metricRows] = await pool.query<Array<{ c: number } & import("mysql2").RowDataPacket>>(
    "SELECT COUNT(*) as c FROM performance_metrics"
  );

  console.log("=== Seed Complete ===");
  console.log(`  tokens:              ${tokenRows[0].c}`);
  console.log(`  pools:               ${poolRows[0].c}`);
  console.log(`  transactions:        ${txRows[0].c}`);
  console.log(`  defi_events:         ${eventRows[0].c}`);
  console.log(`  event_templates:     ${tmplRows[0].c}`);
  console.log(`  performance_metrics: ${metricRows[0].c}`);

  await pool.end();
  process.exit(0);
}

async function insertPool(
  db: ReturnType<typeof getPool>,
  pair: DexScreenerPair
) {
  const dexName =
    pair.dexId.charAt(0).toUpperCase() + pair.dexId.slice(1);

  await db.execute(
    `INSERT INTO pools (id, token_base_id, token_quote_id, pair_label, dex_name, pool_type, chain,
      price_usd, price_change_5m, price_change_1h, price_change_6h, price_change_24h,
      volume_1h, volume_24h, liquidity_usd, market_cap, makers, txns_24h, pool_created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'solana', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      price_usd = VALUES(price_usd), price_change_5m = VALUES(price_change_5m),
      price_change_1h = VALUES(price_change_1h), price_change_6h = VALUES(price_change_6h),
      price_change_24h = VALUES(price_change_24h), volume_1h = VALUES(volume_1h),
      volume_24h = VALUES(volume_24h),
      liquidity_usd = VALUES(liquidity_usd), market_cap = VALUES(market_cap),
      txns_24h = VALUES(txns_24h)`,
    [
      pair.pairAddress,
      pair.baseToken.address,
      pair.quoteToken.address,
      `${pair.baseToken.symbol}/${pair.quoteToken.symbol}`,
      dexName,
      "AMM",
      parseFloat(pair.priceUsd || "0"),
      pair.priceChange?.m5 ?? 0,
      pair.priceChange?.h1 ?? 0,
      pair.priceChange?.h6 ?? 0,
      pair.priceChange?.h24 ?? 0,
      pair.volume?.h1 ?? 0,
      pair.volume?.h24 ?? 0,
      pair.liquidity?.usd ?? 0,
      pair.marketCap ?? pair.fdv ?? 0,
      (pair.txns?.h24?.buys ?? 0) + (pair.txns?.h24?.sells ?? 0),
      (pair.txns?.h24?.buys ?? 0) + (pair.txns?.h24?.sells ?? 0),
      pair.pairCreatedAt ? new Date(pair.pairCreatedAt) : new Date(),
    ]
  );
}

async function generateTransactions(
  db: ReturnType<typeof getPool>,
  pairs: DexScreenerPair[]
) {
  const topPools = pairs
    .sort((a, b) => (b.volume?.h24 ?? 0) - (a.volume?.h24 ?? 0))
    .slice(0, 50);

  const txTypes = ["swap_buy", "swap_sell", "add_liquidity", "remove_liquidity"];
  const txWeights = [40, 40, 10, 10]; // 80% swaps, 10% add, 10% remove

  const BATCH_SIZE = 5000;
  const ROWS_PER_POOL = 20000;
  const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

  let totalInserted = 0;
  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

  for (let p = 0; p < topPools.length; p++) {
    const pool = topPools[p];
    const rows: Array<[string, string, string, number, string, string, Date]> = [];

    for (let i = 0; i < ROWS_PER_POOL; i++) {
      // Weighted random tx type
      const rand = Math.random() * 100;
      let cumWeight = 0;
      let txType = txTypes[0];
      for (let t = 0; t < txTypes.length; t++) {
        cumWeight += txWeights[t];
        if (rand <= cumWeight) {
          txType = txTypes[t];
          break;
        }
      }

      // Power-law amount distribution
      const u = Math.random();
      const amount = Math.round(Math.pow(u, -0.5) * 100) / 100; // Most small, few large

      // Random wallet (from pool of ~10K)
      let wallet = "";
      for (let c = 0; c < 44; c++) {
        wallet += chars[Math.floor(Math.random() * chars.length)];
      }

      // Random tx hash
      let hash = "";
      for (let c = 0; c < 88; c++) {
        hash += chars[Math.floor(Math.random() * chars.length)];
      }

      // Random time in last 30 days
      const timestamp = new Date(
        thirtyDaysAgo + Math.random() * (now - thirtyDaysAgo)
      );

      rows.push([
        pool.pairAddress,
        pool.baseToken.address,
        txType,
        amount,
        wallet,
        hash,
        timestamp,
      ]);

      if (rows.length >= BATCH_SIZE) {
        await batchInsertTransactions(db, rows);
        totalInserted += rows.length;
        rows.length = 0;

        if (totalInserted % 50000 === 0) {
          console.log(`  ${totalInserted.toLocaleString()} transactions inserted...`);
        }
      }
    }

    // Insert remaining
    if (rows.length > 0) {
      await batchInsertTransactions(db, rows);
      totalInserted += rows.length;
    }

    console.log(
      `  Pool ${p + 1}/${topPools.length} done (${pool.baseToken.symbol}). Total: ${totalInserted.toLocaleString()}`
    );
  }

  console.log(`  Total transactions: ${totalInserted.toLocaleString()}`);
}

async function batchInsertTransactions(
  db: ReturnType<typeof getPool>,
  rows: Array<[string, string, string, number, string, string, Date]>
) {
  const placeholders = rows.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(",");
  const values = rows.flat();

  await db.execute(
    `INSERT INTO transactions (pool_id, token_id, tx_type, amount_usd, wallet_address, tx_hash, created_at)
     VALUES ${placeholders}`,
    values
  );
}

async function generateInitialEvents(
  db: ReturnType<typeof getPool>,
  templates: Array<{
    event_type: string;
    token_symbol: string;
    token_logo_url: string;
    description_template: string;
    wallet_address: string;
    amount_usd: number;
    dex_name: string;
  }>
) {
  if (templates.length === 0) {
    console.log("  No templates available, skipping initial events.");
    return;
  }

  const EVENT_COUNT = 5000;
  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

  const BATCH_SIZE = 500;
  let batch: Array<[string, string, string, string, string, number, string, Date]> = [];
  let inserted = 0;

  for (let i = 0; i < EVENT_COUNT; i++) {
    const tmpl = templates[Math.floor(Math.random() * templates.length)];

    // Mutate wallet
    const wallet = tmpl.wallet_address.slice(0, 4) +
      Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("") +
      tmpl.wallet_address.slice(-4);

    // Mutate amount ±20%
    const amount = Math.round(tmpl.amount_usd * (0.8 + Math.random() * 0.4) * 100) / 100;

    // Build description
    const desc = tmpl.description_template
      .replace("{amount}", formatTokenAmount(amount, tmpl.token_symbol))
      .replace("{usd}", formatUsdShort(amount));

    // Random time in last 24h
    const timestamp = new Date(oneDayAgo + Math.random() * (now - oneDayAgo));

    batch.push([
      tmpl.event_type,
      tmpl.token_symbol,
      tmpl.token_logo_url,
      desc,
      wallet,
      amount,
      tmpl.dex_name,
      timestamp,
    ]);

    if (batch.length >= BATCH_SIZE) {
      await batchInsertEvents(db, batch);
      inserted += batch.length;
      batch = [];
    }
  }

  if (batch.length > 0) {
    await batchInsertEvents(db, batch);
    inserted += batch.length;
  }

  console.log(`  Generated ${inserted.toLocaleString()} initial events.`);
}

async function batchInsertEvents(
  db: ReturnType<typeof getPool>,
  rows: Array<[string, string, string, string, string, number, string, Date]>
) {
  const placeholders = rows.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(",");
  const values = rows.flat();

  await db.execute(
    `INSERT INTO defi_events (event_type, token_symbol, token_logo_url, description, wallet_address, amount_usd, dex_name, created_at)
     VALUES ${placeholders}`,
    values
  );
}

async function seedPerformanceMetrics(db: ReturnType<typeof getPool>) {
  // Clear old flat data
  await db.execute("TRUNCATE TABLE performance_metrics");

  const now = Date.now();
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
  const ONE_HOUR = 60 * 60 * 1000;

  // Define spike events across 7 days (minutes ago from now)
  // Each spike: { startMinAgo, peakValue, rampMin, peakMin }
  const spikeEvents = [
    // Within last 1H — large spike for immediate visual impact
    { startMinAgo: 45, peakValue: 45000, rampMin: 5, peakMin: 15 },
    // Within last 6H
    { startMinAgo: 150, peakValue: 35000, rampMin: 5, peakMin: 12 },
    { startMinAgo: 280, peakValue: 25000, rampMin: 4, peakMin: 10 },
    // Within last 24H
    { startMinAgo: 480, peakValue: 35000, rampMin: 5, peakMin: 15 },
    { startMinAgo: 720, peakValue: 45000, rampMin: 5, peakMin: 12 },
    { startMinAgo: 1100, peakValue: 25000, rampMin: 4, peakMin: 10 },
    // Older (24H–7D)
    { startMinAgo: 1600, peakValue: 35000, rampMin: 5, peakMin: 15 },
    { startMinAgo: 2200, peakValue: 25000, rampMin: 4, peakMin: 10 },
    { startMinAgo: 3000, peakValue: 45000, rampMin: 5, peakMin: 15 },
    { startMinAgo: 4500, peakValue: 25000, rampMin: 4, peakMin: 10 },
    { startMinAgo: 6000, peakValue: 35000, rampMin: 5, peakMin: 12 },
    { startMinAgo: 8500, peakValue: 25000, rampMin: 4, peakMin: 10 },
  ];

  const BASELINE_WRITE = 15000;
  const BASELINE_CONN = 1500;
  const BASELINE_QPS = 10000;

  // Helper: compute metric values at a given timestamp
  function computeMetrics(ts: number): { wt: number; ql: number; conn: number; qps: number } {
    const minAgo = (now - ts) / 60000;

    let writeMultiplier = 0; // additional write above baseline
    let connMultiplier = 0;
    let qpsMultiplier = 0;
    let inSpike = false;

    for (const spike of spikeEvents) {
      const spikeStart = spike.startMinAgo;
      const rampUpEnd = spikeStart - spike.rampMin;
      const peakEnd = rampUpEnd - spike.peakMin;
      const rampDownEnd = peakEnd - spike.rampMin;

      if (minAgo <= spikeStart && minAgo > rampUpEnd) {
        // Ramp up
        const progress = (spikeStart - minAgo) / spike.rampMin;
        const extra = (spike.peakValue - BASELINE_WRITE) * progress;
        writeMultiplier = Math.max(writeMultiplier, extra);
        connMultiplier = Math.max(connMultiplier, (2000 * progress));
        qpsMultiplier = Math.max(qpsMultiplier, (4000 * progress));
        inSpike = true;
      } else if (minAgo <= rampUpEnd && minAgo > peakEnd) {
        // Peak
        writeMultiplier = Math.max(writeMultiplier, spike.peakValue - BASELINE_WRITE);
        connMultiplier = Math.max(connMultiplier, 2000);
        qpsMultiplier = Math.max(qpsMultiplier, 4000);
        inSpike = true;
      } else if (minAgo <= peakEnd && minAgo > rampDownEnd) {
        // Ramp down
        const progress = (minAgo - rampDownEnd) / spike.rampMin;
        const extra = (spike.peakValue - BASELINE_WRITE) * progress;
        writeMultiplier = Math.max(writeMultiplier, extra);
        connMultiplier = Math.max(connMultiplier, (2000 * progress));
        qpsMultiplier = Math.max(qpsMultiplier, (4000 * progress));
        inSpike = true;
      }
    }

    const wt = BASELINE_WRITE + writeMultiplier + (Math.random() - 0.5) * 4000;
    const conn = BASELINE_CONN + connMultiplier + (Math.random() - 0.5) * 400;
    const qps = BASELINE_QPS + qpsMultiplier + (Math.random() - 0.5) * 2000;

    // Query latency STAYS FLAT — the HTAP proof
    // Tiny bump during spike (3.0 → 3.3ms) but never dramatic
    const ql = inSpike
      ? 3.3 + (Math.random() - 0.5) * 0.6  // 3.0–3.6ms during spike
      : 3.0 + (Math.random() - 0.5) * 0.6;  // 2.7–3.3ms normal

    return {
      wt: Math.max(1000, Math.round(wt)),
      ql: Math.max(0.5, Math.round(ql * 100) / 100),
      conn: Math.max(100, Math.round(conn)),
      qps: Math.max(1000, Math.round(qps)),
    };
  }

  const BATCH_SIZE = 200;
  let batch: Array<[string, number, Date]> = [];
  let inserted = 0;

  // Recent 1 hour: 5-second intervals (~720 points)
  const oneHourAgo = now - ONE_HOUR;
  for (let ts = oneHourAgo; ts <= now; ts += 5000) {
    const m = computeMetrics(ts);
    const timestamp = new Date(ts);
    batch.push(["write_throughput", m.wt, timestamp]);
    batch.push(["query_latency", m.ql, timestamp]);
    batch.push(["qps", m.qps, timestamp]);
    batch.push(["active_connections", m.conn, timestamp]);

    if (batch.length >= BATCH_SIZE) {
      await batchInsertMetrics(db, batch);
      inserted += batch.length;
      batch = [];
    }
  }

  // 1H–6H ago: 30-second intervals
  const sixHoursAgo = now - 6 * ONE_HOUR;
  for (let ts = sixHoursAgo; ts < oneHourAgo; ts += 30000) {
    const m = computeMetrics(ts);
    const timestamp = new Date(ts);
    batch.push(["write_throughput", m.wt, timestamp]);
    batch.push(["query_latency", m.ql, timestamp]);
    batch.push(["qps", m.qps, timestamp]);
    batch.push(["active_connections", m.conn, timestamp]);

    if (batch.length >= BATCH_SIZE) {
      await batchInsertMetrics(db, batch);
      inserted += batch.length;
      batch = [];
    }
  }

  // 6H–24H ago: 2-minute intervals
  const oneDayAgo = now - 24 * ONE_HOUR;
  for (let ts = oneDayAgo; ts < sixHoursAgo; ts += 120000) {
    const m = computeMetrics(ts);
    const timestamp = new Date(ts);
    batch.push(["write_throughput", m.wt, timestamp]);
    batch.push(["query_latency", m.ql, timestamp]);
    batch.push(["qps", m.qps, timestamp]);
    batch.push(["active_connections", m.conn, timestamp]);

    if (batch.length >= BATCH_SIZE) {
      await batchInsertMetrics(db, batch);
      inserted += batch.length;
      batch = [];
    }
  }

  // 24H–7D ago: 15-minute intervals
  const sevenDaysAgo = now - SEVEN_DAYS;
  for (let ts = sevenDaysAgo; ts < oneDayAgo; ts += 900000) {
    const m = computeMetrics(ts);
    const timestamp = new Date(ts);
    batch.push(["write_throughput", m.wt, timestamp]);
    batch.push(["query_latency", m.ql, timestamp]);
    batch.push(["qps", m.qps, timestamp]);
    batch.push(["active_connections", m.conn, timestamp]);

    if (batch.length >= BATCH_SIZE) {
      await batchInsertMetrics(db, batch);
      inserted += batch.length;
      batch = [];
    }
  }

  if (batch.length > 0) {
    await batchInsertMetrics(db, batch);
    inserted += batch.length;
  }

  const totalPoints = inserted / 4;
  console.log(`  Seeded ${inserted} metric rows (${totalPoints} time points × 4 metrics) across 7 days.`);
  console.log(`  Spike events: ${spikeEvents.length} (small/medium/large intensity).`);
}

async function batchInsertMetrics(
  db: ReturnType<typeof getPool>,
  rows: Array<[string, number, Date]>
) {
  const placeholders = rows.map(() => "(?, ?, ?)").join(",");
  const values = rows.flat();

  await db.execute(
    `INSERT INTO performance_metrics (metric_type, value, recorded_at)
     VALUES ${placeholders}`,
    values
  );
}

function formatTokenAmount(usd: number, symbol: string): string {
  const prices: Record<string, number> = {
    BONK: 0.00003, WIF: 2.5, JUP: 1.2, RAY: 5.0, POPCAT: 0.8,
    SOL: 150, PYTH: 0.4, JTO: 3.5, W: 0.3, RENDER: 7.0,
  };
  const price = prices[symbol] ?? 1;
  const amount = usd / price;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)}K`;
  return amount.toFixed(1);
}

function formatUsdShort(amount: number): string {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(0)}K`;
  return amount.toFixed(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
