/**
 * CHAINSCOPE v2 Seed Script — Use Case Driven Data Collection
 *
 * Targets local TiDB (127.0.0.1:4000) with schema-v2.sql
 *
 * Phases:
 *   1. Fetch real tokens from Jupiter (1,000+)
 *   2. Fetch real pool data from DexScreener (500+ pools)
 *   3. Generate 50,000 wallet profiles
 *   4. Generate 1M+ swap_transactions (constrained by real pool volumes)
 *   5. Derive 100K+ defi_events from transactions
 *   6. Generate token_safety data (correlated with real market cap)
 *   7. Generate price_history (3-min candles, 30 days)
 *   8. Seed performance_metrics (7 days)
 *   9. Generate event_templates for live replay
 *
 * Usage:
 *   TIDB_HOST=127.0.0.1 TIDB_PORT=4000 TIDB_USER=root TIDB_PASSWORD= TIDB_DATABASE=chainscope TIDB_SSL=false npx tsx scripts/seed-v2.ts
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import mysql from "mysql2/promise";

// ─── Config ───────────────────────────────────────────────────────────

const DB_CONFIG = {
  host: process.env.SEED_TIDB_HOST || "127.0.0.1",
  port: Number(process.env.SEED_TIDB_PORT || "4000"),
  user: process.env.SEED_TIDB_USER || "root",
  password: process.env.SEED_TIDB_PASSWORD || "",
  database: process.env.SEED_TIDB_DATABASE || "chainscope",
  waitForConnections: true,
  connectionLimit: 10,
  ssl: (process.env.SEED_TIDB_SSL ?? "false").toLowerCase() === "true"
    ? { minVersion: "TLSv1.2" as const, rejectUnauthorized: true }
    : undefined,
};

const BATCH_SIZE = 5000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function randomBase58(length: number): string {
  let s = "";
  for (let i = 0; i < length; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function formatCompact(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

// ─── Types ────────────────────────────────────────────────────────────

interface JupiterToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
}

interface DexScreenerPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceUsd: string;
  volume: { m5?: number; h1?: number; h6?: number; h24?: number };
  txns: {
    m5?: { buys: number; sells: number };
    h1?: { buys: number; sells: number };
    h6?: { buys: number; sells: number };
    h24?: { buys: number; sells: number };
  };
  priceChange: { m5?: number; h1?: number; h6?: number; h24?: number };
  liquidity?: { usd?: number };
  marketCap?: number;
  fdv?: number;
  pairCreatedAt?: number;
  info?: { imageUrl?: string };
}

interface PoolRow {
  address: string;
  token_base_address: string;
  token_quote_address: string;
  token_base_symbol: string;
  token_quote_symbol: string;
  dex: string;
  price_usd: number;
  volume_5m: number;
  volume_1h: number;
  volume_6h: number;
  volume_24h: number;
  liquidity_usd: number;
  market_cap: number;
  txns_5m_buys: number;
  txns_5m_sells: number;
  txns_1h_buys: number;
  txns_1h_sells: number;
  txns_24h_buys: number;
  txns_24h_sells: number;
  price_change_5m: number;
  price_change_1h: number;
  price_change_6h: number;
  price_change_24h: number;
  pool_created_at: number;
}

interface WalletProfile {
  address: string;
  label: "whale" | "smart_money" | "active_trader" | "bot" | "retail";
  totalVolume: number;
  tradeCount: number;
  buyCount: number;
  sellCount: number;
  poolsTraded: number;
  avgTradeSize: number;
  firstSeen: number;
  lastSeen: number;
}

// ─── Phase 1: Fetch Tokens via DexScreener Search ─────────────────────

const DEXSCREENER_SEARCH_TERMS = [
  // Top Solana tokens by market cap
  "SOL", "BONK", "WIF", "JUP", "RAY", "ORCA", "PYTH", "JTO",
  "RENDER", "HNT", "MOBILE", "TRUMP", "POPCAT", "MEW", "BOME",
  "MYRO", "SAMO", "MNDE", "MSOL", "JSOL", "USDC", "USDT",
  "WETH", "WBTC", "KMNO", "DRIFT", "TENSOR", "STEP", "MANGO",
  "AI16Z", "FARTCOIN", "MOTHER", "CLOUD", "PNUT", "INF", "IO",
  "NOS", "SHDW", "jitoSOL", "MPLX",
  // DeFi & infrastructure
  "MARINADE", "RAYDIUM", "JUPITER", "METEORA", "HELIUM", "HIVEMAPPER",
  "GRASS", "PARCL", "SANCTUM", "JITO", "BLZE", "BSOL", "HUBSOL",
  "TNSR", "ACCESS", "HONEY", "FORGE", "GECKO",
  // Meme & culture
  "solana meme", "solana defi", "solana gaming", "solana NFT",
  "pump", "cat", "dog", "pepe", "doge", "moon", "based", "chad",
  "wojak", "cope", "monkey", "frog", "bear", "bull",
  // Broader searches for pool breadth
  "new solana token", "trending solana", "solana launch",
  "orca pool", "raydium pool", "meteora pool", "jupiter swap",
  "solana staking", "solana yield", "solana AI",
];

async function fetchTokensViaDexScreener(): Promise<{ tokens: JupiterToken[]; pairs: DexScreenerPair[] }> {
  console.log("Phase 1: Fetching tokens via DexScreener search...");
  const allPairs: DexScreenerPair[] = [];
  const tokenMap = new Map<string, JupiterToken>();

  for (let i = 0; i < DEXSCREENER_SEARCH_TERMS.length; i++) {
    const query = DEXSCREENER_SEARCH_TERMS[i];
    try {
      const res = await fetch(
        `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`,
        { signal: AbortSignal.timeout(10000) }
      );

      if (res.ok) {
        const data = await res.json();
        const solanaPairs: DexScreenerPair[] = (data.pairs || []).filter(
          (p: DexScreenerPair) => p.chainId === "solana"
        );
        allPairs.push(...solanaPairs);

        // Extract unique tokens
        for (const p of solanaPairs) {
          if (!tokenMap.has(p.baseToken.address)) {
            tokenMap.set(p.baseToken.address, {
              address: p.baseToken.address,
              symbol: p.baseToken.symbol,
              name: p.baseToken.name,
              decimals: 9, // default for Solana
              logoURI: p.info?.imageUrl,
            });
          }
        }
      }
    } catch {
      console.warn(`  Search "${query}" failed, skipping...`);
    }

    if (i < DEXSCREENER_SEARCH_TERMS.length - 1) {
      await sleep(350); // Rate limit: ~3 req/sec
    }

    if ((i + 1) % 10 === 0) {
      console.log(`  Searched ${i + 1}/${DEXSCREENER_SEARCH_TERMS.length} terms (${tokenMap.size} tokens, ${allPairs.length} pairs)`);
    }
  }

  // Deduplicate pairs by pool address
  const uniquePairs = Array.from(new Map(allPairs.map((p) => [p.pairAddress, p])).values());
  uniquePairs.sort((a, b) => (b.volume?.h24 ?? 0) - (a.volume?.h24 ?? 0));

  const tokens = Array.from(tokenMap.values());
  console.log(`  Total unique tokens: ${tokens.length}`);
  console.log(`  Total unique pairs: ${uniquePairs.length}\n`);

  return { tokens, pairs: uniquePairs };
}

async function insertTokens(db: mysql.Pool, tokens: JupiterToken[]) {
  let inserted = 0;
  const batch: Array<[string, string, string, number, string | null]> = [];

  for (const t of tokens) {
    batch.push([t.address, t.name, t.symbol, t.decimals, t.logoURI || null]);

    if (batch.length >= 500) {
      const ph = batch.map(() => "(?, ?, ?, ?, ?)").join(",");
      await db.execute(
        `INSERT IGNORE INTO tokens (address, name, symbol, decimals, logo_url) VALUES ${ph}`,
        batch.flat()
      );
      inserted += batch.length;
      batch.length = 0;
    }
  }

  if (batch.length > 0) {
    const ph = batch.map(() => "(?, ?, ?, ?, ?)").join(",");
    await db.execute(
      `INSERT IGNORE INTO tokens (address, name, symbol, decimals, logo_url) VALUES ${ph}`,
      batch.flat()
    );
    inserted += batch.length;
  }

  console.log(`  Inserted ${inserted} tokens.\n`);
  return inserted;
}

// ─── Phase 2: Insert Pools (from DexScreener search results) ──────────

async function insertPools(db: mysql.Pool, pairs: DexScreenerPair[]): Promise<PoolRow[]> {
  const pools: PoolRow[] = [];
  let inserted = 0;

  for (const p of pairs) {
    const row: PoolRow = {
      address: p.pairAddress,
      token_base_address: p.baseToken.address,
      token_quote_address: p.quoteToken.address,
      token_base_symbol: p.baseToken.symbol,
      token_quote_symbol: p.quoteToken.symbol,
      dex: p.dexId.charAt(0).toUpperCase() + p.dexId.slice(1),
      price_usd: parseFloat(p.priceUsd || "0"),
      volume_5m: p.volume?.m5 ?? 0,
      volume_1h: p.volume?.h1 ?? 0,
      volume_6h: p.volume?.h6 ?? 0,
      volume_24h: p.volume?.h24 ?? 0,
      liquidity_usd: p.liquidity?.usd ?? 0,
      market_cap: p.marketCap ?? p.fdv ?? 0,
      txns_5m_buys: p.txns?.m5?.buys ?? 0,
      txns_5m_sells: p.txns?.m5?.sells ?? 0,
      txns_1h_buys: p.txns?.h1?.buys ?? 0,
      txns_1h_sells: p.txns?.h1?.sells ?? 0,
      txns_24h_buys: p.txns?.h24?.buys ?? 0,
      txns_24h_sells: p.txns?.h24?.sells ?? 0,
      price_change_5m: p.priceChange?.m5 ?? 0,
      price_change_1h: p.priceChange?.h1 ?? 0,
      price_change_6h: p.priceChange?.h6 ?? 0,
      price_change_24h: p.priceChange?.h24 ?? 0,
      pool_created_at: p.pairCreatedAt ?? Date.now(),
    };
    pools.push(row);

    try {
      await db.execute(
        `INSERT INTO pools (address, token_base_address, token_quote_address, token_base_symbol,
          token_quote_symbol, dex, price_usd, volume_5m, volume_1h, volume_6h, volume_24h,
          liquidity_usd, market_cap, txns_5m_buys, txns_5m_sells, txns_1h_buys, txns_1h_sells,
          txns_24h_buys, txns_24h_sells, price_change_5m, price_change_1h, price_change_6h,
          price_change_24h, pool_created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE price_usd = VALUES(price_usd), volume_24h = VALUES(volume_24h)`,
        [
          row.address, row.token_base_address, row.token_quote_address, row.token_base_symbol,
          row.token_quote_symbol, row.dex, row.price_usd, row.volume_5m, row.volume_1h,
          row.volume_6h, row.volume_24h, row.liquidity_usd, row.market_cap,
          row.txns_5m_buys, row.txns_5m_sells, row.txns_1h_buys, row.txns_1h_sells,
          row.txns_24h_buys, row.txns_24h_sells, row.price_change_5m, row.price_change_1h,
          row.price_change_6h, row.price_change_24h, row.pool_created_at,
        ]
      );
      inserted++;
    } catch {
      // Skip duplicates silently
    }
  }

  console.log(`  Inserted ${inserted} pools.\n`);
  return pools;
}

// ─── Phase 3: Generate Wallet Profiles ────────────────────────────────

function generateWallets(): WalletProfile[] {
  console.log("Phase 3: Generating 50,000 wallet profiles...");
  const now = Date.now();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  const wallets: WalletProfile[] = [];

  function makeWallet(
    label: WalletProfile["label"],
    volMin: number, volMax: number,
    tradesMin: number, tradesMax: number,
    buyRatio: number,
    poolsMin: number, poolsMax: number,
  ): WalletProfile {
    const totalVolume = volMin + Math.random() * (volMax - volMin);
    const tradeCount = tradesMin + Math.floor(Math.random() * (tradesMax - tradesMin));
    const buyCount = Math.round(tradeCount * buyRatio);
    const sellCount = tradeCount - buyCount;
    const poolsTraded = poolsMin + Math.floor(Math.random() * (poolsMax - poolsMin));
    const firstSeen = now - Math.floor(Math.random() * thirtyDaysMs);
    const lastSeen = firstSeen + Math.floor(Math.random() * (now - firstSeen));

    return {
      address: randomBase58(44),
      label,
      totalVolume: Math.round(totalVolume * 100) / 100,
      tradeCount,
      buyCount,
      sellCount,
      poolsTraded,
      avgTradeSize: Math.round((totalVolume / tradeCount) * 100) / 100,
      firstSeen,
      lastSeen,
    };
  }

  // Whale: 500 wallets
  for (let i = 0; i < 500; i++) {
    wallets.push(makeWallet("whale", 100_000, 10_000_000, 60, 150, 0.4 + Math.random() * 0.2, 5, 20));
  }

  // Smart money: 1,500 wallets
  for (let i = 0; i < 1500; i++) {
    wallets.push(makeWallet("smart_money", 50_000, 500_000, 90, 240, 0.6 + Math.random() * 0.2, 10, 30));
  }

  // Active trader: 5,000 wallets
  for (let i = 0; i < 5000; i++) {
    wallets.push(makeWallet("active_trader", 5_000, 100_000, 30, 150, 0.45 + Math.random() * 0.1, 3, 10));
  }

  // Bot / MM: 2,000 wallets
  for (let i = 0; i < 2000; i++) {
    wallets.push(makeWallet("bot", 500_000, 5_000_000, 1500, 5000, 0.48 + Math.random() * 0.04, 1, 5));
  }

  // Retail: 41,000 wallets
  for (let i = 0; i < 41000; i++) {
    wallets.push(makeWallet("retail", 100, 5_000, 3, 20, 0.3 + Math.random() * 0.4, 1, 3));
  }

  console.log(`  Generated ${wallets.length} wallet profiles.\n`);
  return wallets;
}

async function insertWallets(db: mysql.Pool, wallets: WalletProfile[]) {
  let inserted = 0;
  const batchRows: unknown[][] = [];

  for (const w of wallets) {
    batchRows.push([
      w.address, w.label, w.totalVolume, w.tradeCount,
      w.buyCount, w.sellCount, w.poolsTraded, w.avgTradeSize,
      w.firstSeen, w.lastSeen,
    ]);

    if (batchRows.length >= BATCH_SIZE) {
      const ph = batchRows.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(",");
      await db.execute(
        `INSERT INTO wallet_profiles (address, label, total_volume, trade_count, buy_count, sell_count, pools_traded, avg_trade_size, first_seen, last_seen) VALUES ${ph}`,
        batchRows.flat()
      );
      inserted += batchRows.length;
      batchRows.length = 0;
      if (inserted % 10000 === 0) console.log(`  ${inserted.toLocaleString()} wallets inserted...`);
    }
  }

  if (batchRows.length > 0) {
    const ph = batchRows.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(",");
    await db.execute(
      `INSERT INTO wallet_profiles (address, label, total_volume, trade_count, buy_count, sell_count, pools_traded, avg_trade_size, first_seen, last_seen) VALUES ${ph}`,
      batchRows.flat()
    );
    inserted += batchRows.length;
  }

  console.log(`  Inserted ${inserted.toLocaleString()} wallet profiles.\n`);
}

// ─── Phase 4: Generate Swap Transactions ──────────────────────────────

async function generateTransactions(db: mysql.Pool, pools: PoolRow[], wallets: WalletProfile[]) {
  console.log("Phase 4: Generating swap transactions...");

  const now = Date.now();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

  // Use top pools sorted by volume — power-law distribution
  const topPools = pools
    .filter((p) => p.volume_24h > 0)
    .sort((a, b) => b.volume_24h - a.volume_24h)
    .slice(0, 500);

  if (topPools.length === 0) {
    console.warn("  No pools with volume! Skipping transaction generation.");
    return 0;
  }

  // Pool weights for power-law selection
  const poolWeights = topPools.map((_, i) => Math.pow(topPools.length - i, 2));
  const totalWeight = poolWeights.reduce((s, w) => s + w, 0);

  function pickPool(): PoolRow {
    let r = Math.random() * totalWeight;
    for (let i = 0; i < poolWeights.length; i++) {
      r -= poolWeights[i];
      if (r <= 0) return topPools[i];
    }
    return topPools[0];
  }

  // Separate wallet lists by label for selection
  const whaleWallets = wallets.filter((w) => w.label === "whale");
  const smartMoneyWallets = wallets.filter((w) => w.label === "smart_money");
  const otherWallets = wallets.filter((w) => !["whale", "smart_money"].includes(w.label));

  function pickWallet(): WalletProfile {
    const r = Math.random();
    if (r < 0.01) return whaleWallets[Math.floor(Math.random() * whaleWallets.length)];
    if (r < 0.05) return smartMoneyWallets[Math.floor(Math.random() * smartMoneyWallets.length)];
    return otherWallets[Math.floor(Math.random() * otherWallets.length)];
  }

  const TARGET_COUNT = 7_000_000;
  let totalInserted = 0;
  let batch: unknown[][] = [];

  for (let i = 0; i < TARGET_COUNT; i++) {
    const pool = pickPool();
    const wallet = pickWallet();

    // Timestamp: bias toward recent (power-law)
    const recencyBias = Math.pow(Math.random(), 0.7);
    const timestamp = now - Math.floor(recencyBias * thirtyDaysMs);

    // Trade size: log-normal distribution
    const isWhaleWallet = wallet.label === "whale";
    let usdValue: number;
    if (isWhaleWallet) {
      usdValue = Math.exp(Math.random() * 4 + 7); // $1K - $55K
    } else if (wallet.label === "bot") {
      usdValue = Math.exp(Math.random() * 2 + 5); // ~$150 - $1K, consistent
    } else {
      usdValue = Math.exp(Math.random() * 5 + 2); // $7 - $1K
    }
    usdValue = Math.round(usdValue * 100) / 100;

    // Side: smart money buys more
    const isBuy = wallet.label === "smart_money"
      ? Math.random() < 0.65
      : Math.random() < 0.50;

    let baseAmount = pool.price_usd > 0 ? usdValue / pool.price_usd : usdValue;
    // Clamp to fit DECIMAL(20,6) — max ~99999999999999
    baseAmount = Math.min(baseAmount, 99_999_999_999_999);
    baseAmount = Math.round(baseAmount * 1_000_000) / 1_000_000;
    const sig = randomBase58(88);

    batch.push([
      sig,
      timestamp,
      pool.address,
      pool.dex,
      isBuy ? "buy" : "sell",
      baseAmount,
      usdValue,
      usdValue,
      wallet.address,
    ]);

    if (batch.length >= BATCH_SIZE) {
      const ph = batch.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?)").join(",");
      await db.execute(
        `INSERT INTO swap_transactions (signature, timestamp, pool_address, dex, side, base_amount, quote_amount, usd_value, trader_wallet) VALUES ${ph}`,
        batch.flat()
      );
      totalInserted += batch.length;
      batch = [];

      if (totalInserted % 50000 === 0) {
        console.log(`  ${totalInserted.toLocaleString()} / ${TARGET_COUNT.toLocaleString()} transactions inserted...`);
      }
    }
  }

  if (batch.length > 0) {
    const ph = batch.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?)").join(",");
    await db.execute(
      `INSERT INTO swap_transactions (signature, timestamp, pool_address, dex, side, base_amount, quote_amount, usd_value, trader_wallet) VALUES ${ph}`,
      batch.flat()
    );
    totalInserted += batch.length;
  }

  console.log(`  Total transactions: ${totalInserted.toLocaleString()}\n`);
  return totalInserted;
}

// ─── Phase 5: Generate DeFi Events ───────────────────────────────────

async function generateEvents(db: mysql.Pool, pools: PoolRow[], wallets: WalletProfile[]) {
  console.log("Phase 5: Generating defi_events...");

  const now = Date.now();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  const topPools = pools.filter((p) => p.volume_24h > 0).slice(0, 200);
  const whaleWallets = wallets.filter((w) => w.label === "whale");
  const smartWallets = wallets.filter((w) => w.label === "smart_money");
  const dexes = ["Raydium", "Orca", "Meteora", "Jupiter"];

  let totalInserted = 0;
  let batch: unknown[][] = [];

  async function flushBatch() {
    if (batch.length === 0) return;
    const ph = batch.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(",");
    await db.execute(
      `INSERT INTO defi_events (timestamp, pool_address, dex, event_type, severity, trader_wallet, usd_value, description) VALUES ${ph}`,
      batch.flat()
    );
    totalInserted += batch.length;
    batch = [];
  }

  // Whale events: ~70,000
  for (let i = 0; i < 70000; i++) {
    const pool = topPools[Math.floor(Math.random() * topPools.length)];
    const wallet = whaleWallets[Math.floor(Math.random() * whaleWallets.length)];
    const usdValue = Math.round((10000 + Math.random() * 90000) * 100) / 100;
    const side = Math.random() > 0.5 ? "bought" : "sold";
    const ts = now - Math.floor(Math.pow(Math.random(), 0.7) * thirtyDaysMs);

    batch.push([
      ts, pool.address, pool.dex, "whale", "high",
      wallet.address, usdValue,
      `whale ${side} ${formatCompact(usdValue / (pool.price_usd || 1))} ${pool.token_base_symbol} $${formatCompact(usdValue)} via ${pool.dex}`,
    ]);
    if (batch.length >= BATCH_SIZE) await flushBatch();
  }

  // Large trade events: ~280,000
  for (let i = 0; i < 280000; i++) {
    const pool = topPools[Math.floor(Math.random() * topPools.length)];
    const wallet = wallets[Math.floor(Math.random() * wallets.length)];
    const usdValue = Math.round((500 + Math.random() * 9500) * 100) / 100;
    const side = Math.random() > 0.5 ? "bought" : "sold";
    const ts = now - Math.floor(Math.pow(Math.random(), 0.7) * thirtyDaysMs);

    batch.push([
      ts, pool.address, pool.dex, "large_trade", "medium",
      wallet.address, usdValue,
      `${side} ${formatCompact(usdValue / (pool.price_usd || 1))} ${pool.token_base_symbol} $${formatCompact(usdValue)} via ${pool.dex}`,
    ]);
    if (batch.length >= BATCH_SIZE) await flushBatch();
  }

  // Smart money events: ~35,000
  for (let i = 0; i < 35000; i++) {
    const pool = topPools[Math.floor(Math.random() * topPools.length)];
    const wallet = smartWallets[Math.floor(Math.random() * smartWallets.length)];
    const usdValue = Math.round((5000 + Math.random() * 45000) * 100) / 100;
    const ts = now - Math.floor(Math.pow(Math.random(), 0.7) * thirtyDaysMs);

    batch.push([
      ts, pool.address, pool.dex, "smart_money", "high",
      wallet.address, usdValue,
      `smart money bought ${formatCompact(usdValue / (pool.price_usd || 1))} ${pool.token_base_symbol} $${formatCompact(usdValue)} via ${pool.dex}`,
    ]);
    if (batch.length >= BATCH_SIZE) await flushBatch();
  }

  // Liquidity events: ~35,000
  for (let i = 0; i < 35000; i++) {
    const pool = topPools[Math.floor(Math.random() * topPools.length)];
    const wallet = wallets[Math.floor(Math.random() * wallets.length)];
    const isAdd = Math.random() > 0.4;
    const usdValue = Math.round((10000 + Math.random() * 490000) * 100) / 100;
    const ts = now - Math.floor(Math.pow(Math.random(), 0.7) * thirtyDaysMs);

    batch.push([
      ts, pool.address, pool.dex,
      isAdd ? "liquidity_add" : "liquidity_remove",
      "medium",
      wallet.address, usdValue,
      `${isAdd ? "added" : "removed"} $${formatCompact(usdValue)} liquidity ${isAdd ? "to" : "from"} ${pool.token_base_symbol} on ${pool.dex}`,
    ]);
    if (batch.length >= BATCH_SIZE) await flushBatch();
  }

  // New pool events: ~3,500
  for (let i = 0; i < 3500; i++) {
    const pool = topPools[Math.floor(Math.random() * topPools.length)];
    const dex = dexes[Math.floor(Math.random() * dexes.length)];
    const ts = now - Math.floor(Math.random() * thirtyDaysMs);

    batch.push([
      ts, pool.address, dex, "new_pool", "high",
      null, null,
      `new ${pool.token_base_symbol}/${pool.token_quote_symbol} pool created on ${dex}`,
    ]);
    if (batch.length >= BATCH_SIZE) await flushBatch();
  }

  await flushBatch();
  console.log(`  Total events: ${totalInserted.toLocaleString()}\n`);
}

// ─── Phase 6: Generate Token Safety ──────────────────────────────────

async function generateTokenSafety(db: mysql.Pool, pools: PoolRow[]) {
  console.log("Phase 6: Generating token_safety data...");

  // Deduplicate tokens from pools
  const tokenMap = new Map<string, { address: string; marketCap: number }>();
  for (const p of pools) {
    const existing = tokenMap.get(p.token_base_address);
    if (!existing || p.market_cap > existing.marketCap) {
      tokenMap.set(p.token_base_address, { address: p.token_base_address, marketCap: p.market_cap });
    }
  }

  const tokens = [...tokenMap.values()].sort((a, b) => b.marketCap - a.marketCap);
  let inserted = 0;
  const batch: unknown[][] = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const rank = i;
    let holderCount: number, top10Pct: number, lpLocked: boolean, isSuspicious: boolean;

    if (rank < 50) {
      // High-cap
      holderCount = 50000 + Math.floor(Math.random() * 450000);
      top10Pct = 15 + Math.random() * 15;
      lpLocked = Math.random() < 0.9;
      isSuspicious = false;
    } else if (rank < 200) {
      // Mid-cap
      holderCount = 5000 + Math.floor(Math.random() * 45000);
      top10Pct = 25 + Math.random() * 20;
      lpLocked = Math.random() < 0.6;
      isSuspicious = false;
    } else if (rank < 500) {
      // Small-cap
      holderCount = 500 + Math.floor(Math.random() * 4500);
      top10Pct = 40 + Math.random() * 25;
      lpLocked = Math.random() < 0.3;
      isSuspicious = Math.random() < 0.05;
    } else {
      // Micro-cap
      holderCount = 50 + Math.floor(Math.random() * 450);
      top10Pct = 60 + Math.random() * 30;
      lpLocked = Math.random() < 0.2;
      isSuspicious = Math.random() < 0.1;
    }

    const safetyScore = Math.max(0, Math.min(100, Math.round(
      (lpLocked ? 30 : 0) +
      (100 - top10Pct) * 0.4 +
      Math.min(holderCount / 5000, 1) * 20 +
      (isSuspicious ? -30 : 0)
    )));

    batch.push([
      t.address, holderCount, Math.round(top10Pct * 100) / 100,
      lpLocked, isSuspicious, safetyScore,
    ]);

    if (batch.length >= 500) {
      const ph = batch.map(() => "(?, ?, ?, ?, ?, ?)").join(",");
      await db.execute(
        `INSERT IGNORE INTO token_safety (token_address, holder_count, top10_holder_pct, lp_locked, is_suspicious, safety_score) VALUES ${ph}`,
        batch.flat()
      );
      inserted += batch.length;
      batch.length = 0;
    }
  }

  if (batch.length > 0) {
    const ph = batch.map(() => "(?, ?, ?, ?, ?, ?)").join(",");
    await db.execute(
      `INSERT IGNORE INTO token_safety (token_address, holder_count, top10_holder_pct, lp_locked, is_suspicious, safety_score) VALUES ${ph}`,
      batch.flat()
    );
    inserted += batch.length;
  }

  console.log(`  Inserted ${inserted} token safety records.\n`);
}

// ─── Phase 7: Generate Price History ─────────────────────────────────

async function generatePriceHistory(db: mysql.Pool, pools: PoolRow[]) {
  console.log("Phase 7: Generating price_history (3-min candles, 30 days)...");

  const now = Date.now();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  const threeMinMs = 3 * 60 * 1000;
  const candlesPerPool = Math.floor(thirtyDaysMs / threeMinMs); // ~14,400

  // Generate for top 200 pools
  const topPools = pools
    .filter((p) => p.price_usd > 0)
    .sort((a, b) => b.volume_24h - a.volume_24h)
    .slice(0, 200);

  let totalInserted = 0;

  for (let pi = 0; pi < topPools.length; pi++) {
    const pool = topPools[pi];
    let batch: unknown[][] = [];

    // Determine volatility based on market cap
    let dailyVol: number;
    if (pool.market_cap > 1_000_000_000) {
      dailyVol = 0.02 + Math.random() * 0.03; // 2-5%
    } else if (pool.market_cap > 100_000_000) {
      dailyVol = 0.05 + Math.random() * 0.10; // 5-15%
    } else if (pool.market_cap > 10_000_000) {
      dailyVol = 0.10 + Math.random() * 0.15; // 10-25%
    } else {
      dailyVol = 0.15 + Math.random() * 0.35; // 15-50%
    }

    // Per-candle volatility (from daily vol)
    const candleVol = dailyVol / Math.sqrt(480); // ~480 3-min candles per day

    // Walk backward from current price
    let price = pool.price_usd;
    const startTs = now - thirtyDaysMs;

    for (let c = candlesPerPool - 1; c >= 0; c--) {
      const ts = startTs + c * threeMinMs;

      // Random walk with mean reversion toward current price
      const drift = (pool.price_usd - price) * 0.0001; // gentle pull toward current
      const change = drift + (Math.random() - 0.5) * 2 * candleVol * price;
      const open = price;
      price = Math.max(price * 0.5, price + change); // prevent going negative

      const intraHigh = Math.max(open, price) * (1 + Math.random() * candleVol * 0.5);
      const intraLow = Math.min(open, price) * (1 - Math.random() * candleVol * 0.5);
      const vol = pool.volume_24h > 0
        ? (pool.volume_24h / 480) * (0.5 + Math.random())
        : Math.random() * 1000;

      batch.push([
        pool.address, ts, open, intraHigh, intraLow, price, Math.round(vol * 100) / 100,
      ]);

      if (batch.length >= BATCH_SIZE) {
        const ph = batch.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(",");
        await db.execute(
          `INSERT INTO price_history (pool_address, timestamp, open, high, low, close, volume) VALUES ${ph}`,
          batch.flat()
        );
        totalInserted += batch.length;
        batch = [];
      }
    }

    if (batch.length > 0) {
      const ph = batch.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(",");
      await db.execute(
        `INSERT INTO price_history (pool_address, timestamp, open, high, low, close, volume) VALUES ${ph}`,
        batch.flat()
      );
      totalInserted += batch.length;
    }

    if ((pi + 1) % 10 === 0) {
      console.log(`  Pool ${pi + 1}/${topPools.length} done. Total candles: ${totalInserted.toLocaleString()}`);
    }
  }

  console.log(`  Total price history candles: ${totalInserted.toLocaleString()}\n`);
}

// ─── Phase 8: Seed Performance Metrics ───────────────────────────────

async function seedPerformanceMetrics(db: mysql.Pool) {
  console.log("Phase 8: Seeding performance metrics (7 days)...");
  await db.execute("TRUNCATE TABLE performance_metrics");

  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000;

  const spikeEvents = [
    { startMinAgo: 45, peakValue: 45000, rampMin: 5, peakMin: 15 },
    { startMinAgo: 150, peakValue: 35000, rampMin: 5, peakMin: 12 },
    { startMinAgo: 280, peakValue: 25000, rampMin: 4, peakMin: 10 },
    { startMinAgo: 480, peakValue: 35000, rampMin: 5, peakMin: 15 },
    { startMinAgo: 720, peakValue: 45000, rampMin: 5, peakMin: 12 },
    { startMinAgo: 1100, peakValue: 25000, rampMin: 4, peakMin: 10 },
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

  function computeMetrics(ts: number) {
    const minAgo = (now - ts) / 60000;
    let writeExtra = 0, connExtra = 0, qpsExtra = 0, inSpike = false;

    for (const sp of spikeEvents) {
      const rampEnd = sp.startMinAgo - sp.rampMin;
      const peakEnd = rampEnd - sp.peakMin;
      const downEnd = peakEnd - sp.rampMin;

      if (minAgo <= sp.startMinAgo && minAgo > rampEnd) {
        const p = (sp.startMinAgo - minAgo) / sp.rampMin;
        writeExtra = Math.max(writeExtra, (sp.peakValue - BASELINE_WRITE) * p);
        connExtra = Math.max(connExtra, 2000 * p);
        qpsExtra = Math.max(qpsExtra, 4000 * p);
        inSpike = true;
      } else if (minAgo <= rampEnd && minAgo > peakEnd) {
        writeExtra = Math.max(writeExtra, sp.peakValue - BASELINE_WRITE);
        connExtra = Math.max(connExtra, 2000);
        qpsExtra = Math.max(qpsExtra, 4000);
        inSpike = true;
      } else if (minAgo <= peakEnd && minAgo > downEnd) {
        const p = (minAgo - downEnd) / sp.rampMin;
        writeExtra = Math.max(writeExtra, (sp.peakValue - BASELINE_WRITE) * p);
        connExtra = Math.max(connExtra, 2000 * p);
        qpsExtra = Math.max(qpsExtra, 4000 * p);
        inSpike = true;
      }
    }

    return {
      wt: Math.max(1000, Math.round(BASELINE_WRITE + writeExtra + (Math.random() - 0.5) * 4000)),
      ql: Math.max(0.5, Math.round((inSpike ? 3.3 : 3.0 + (Math.random() - 0.5) * 0.6) * 100) / 100),
      conn: Math.max(100, Math.round(BASELINE_CONN + connExtra + (Math.random() - 0.5) * 400)),
      qps: Math.max(1000, Math.round(BASELINE_QPS + qpsExtra + (Math.random() - 0.5) * 2000)),
    };
  }

  let batch: Array<[string, number, Date]> = [];
  let inserted = 0;

  const intervals: Array<[number, number, number]> = [
    [now - ONE_HOUR, now, 5000],               // Last 1H: 5s
    [now - 6 * ONE_HOUR, now - ONE_HOUR, 30000], // 1-6H: 30s
    [now - 24 * ONE_HOUR, now - 6 * ONE_HOUR, 120000], // 6-24H: 2min
    [now - 7 * 24 * ONE_HOUR, now - 24 * ONE_HOUR, 900000], // 1-7D: 15min
  ];

  for (const [start, end, step] of intervals) {
    for (let ts = start; ts <= end; ts += step) {
      const m = computeMetrics(ts);
      const d = new Date(ts);
      batch.push(["write_throughput", m.wt, d]);
      batch.push(["query_latency", m.ql, d]);
      batch.push(["qps", m.qps, d]);
      batch.push(["active_connections", m.conn, d]);

      if (batch.length >= 200) {
        const ph = batch.map(() => "(?, ?, ?)").join(",");
        await db.execute(
          `INSERT INTO performance_metrics (metric_type, value, recorded_at) VALUES ${ph}`,
          batch.flat()
        );
        inserted += batch.length;
        batch = [];
      }
    }
  }

  if (batch.length > 0) {
    const ph = batch.map(() => "(?, ?, ?)").join(",");
    await db.execute(
      `INSERT INTO performance_metrics (metric_type, value, recorded_at) VALUES ${ph}`,
      batch.flat()
    );
    inserted += batch.length;
  }

  console.log(`  Seeded ${inserted} metric rows.\n`);
}

// ─── Phase 9: Generate Event Templates ───────────────────────────────

async function generateEventTemplates(db: mysql.Pool, pools: PoolRow[]) {
  console.log("Phase 9: Generating event templates for live replay...");

  const topPools = pools.filter((p) => p.volume_24h > 0).slice(0, 50);
  const dexes = ["Raydium", "Orca", "Meteora", "Jupiter"];
  let inserted = 0;

  for (const pool of topPools) {
    const templates = [
      { type: "swap", desc: `bought {amount} ${pool.token_base_symbol} \${usd} via ${pool.dex}`, amount: 500 + Math.random() * 5000 },
      { type: "swap", desc: `sold {amount} ${pool.token_base_symbol} \${usd} via ${pool.dex}`, amount: 500 + Math.random() * 5000 },
      { type: "whale", desc: `whale bought {amount} ${pool.token_base_symbol} \${usd} via ${pool.dex}`, amount: 10000 + Math.random() * 90000 },
      { type: "liquidity", desc: `added \${usd} liquidity to ${pool.token_base_symbol} on ${pool.dex}`, amount: 50000 + Math.random() * 450000 },
      { type: "smart_money", desc: `smart money bought {amount} ${pool.token_base_symbol} \${usd} via ${pool.dex}`, amount: 5000 + Math.random() * 45000 },
    ];

    for (const tmpl of templates) {
      await db.execute(
        `INSERT INTO event_templates (event_type, token_symbol, token_logo_url, description_template, wallet_address, amount_usd, dex_name, tx_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tmpl.type, pool.token_base_symbol, null,
          tmpl.desc, randomBase58(44), Math.round(tmpl.amount * 100) / 100,
          pool.dex, randomBase58(88),
        ]
      );
      inserted++;
    }
  }

  // New pool templates
  for (let i = 0; i < 10; i++) {
    const pool = topPools[Math.floor(Math.random() * topPools.length)];
    const dex = dexes[Math.floor(Math.random() * dexes.length)];
    await db.execute(
      `INSERT INTO event_templates (event_type, token_symbol, description_template, wallet_address, amount_usd, dex_name) VALUES (?, ?, ?, ?, ?, ?)`,
      ["new_pool", pool.token_base_symbol, `new ${pool.token_base_symbol}/${pool.token_quote_symbol} pool created on ${dex}`, randomBase58(44), 0, dex]
    );
    inserted++;
  }

  console.log(`  Inserted ${inserted} event templates.\n`);
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log("=== CHAINSCOPE v2 Seed Script ===");
  console.log(`Target: ${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_CONFIG.database}`);
  console.log(`SSL: ${DB_CONFIG.ssl ? "enabled" : "disabled"}\n`);

  const db = mysql.createPool(DB_CONFIG);

  // Verify connection
  try {
    await db.query("SELECT 1");
    console.log("Database connection verified ✅\n");
  } catch (e) {
    console.error("Database connection FAILED ❌:", e);
    process.exit(1);
  }

  const startTime = Date.now();

  // Phase 1+2: Tokens and Pools from DexScreener search
  const { tokens, pairs: dexPairs } = await fetchTokensViaDexScreener();
  await insertTokens(db, tokens);
  console.log("Phase 2: Inserting pools...");
  const pools = await insertPools(db, dexPairs);

  // Phase 3: Wallet profiles
  const wallets = generateWallets();
  await insertWallets(db, wallets);

  // Phase 4: Swap transactions (1M+)
  await generateTransactions(db, pools, wallets);

  // Phase 5: DeFi events
  await generateEvents(db, pools, wallets);

  // Phase 6: Token safety
  await generateTokenSafety(db, pools);

  // Phase 7: Price history
  await generatePriceHistory(db, pools);

  // Phase 8: Performance metrics
  await seedPerformanceMetrics(db);

  // Phase 9: Event templates
  await generateEventTemplates(db, pools);

  // ─── Summary ─────────────────────────────────────────────────
  const tables = ["tokens", "pools", "pool_snapshots", "swap_transactions", "wallet_profiles", "token_safety", "defi_events", "price_history", "performance_metrics", "event_templates"];
  console.log("=== Seed Complete ===");

  let totalRows = 0;
  for (const table of tables) {
    const [rows] = await db.query<Array<{ c: number } & mysql.RowDataPacket>>(
      `SELECT COUNT(*) as c FROM ${table}`
    );
    const count = rows[0]?.c ?? 0;
    totalRows += count;
    console.log(`  ${table.padEnd(25)} ${count.toLocaleString()}`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n  Total rows: ${totalRows.toLocaleString()}`);
  console.log(`  Elapsed: ${elapsed}s`);

  await db.end();
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
