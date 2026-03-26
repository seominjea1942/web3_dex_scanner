/**
 * Add New Pools Script — Fetches trending/popular pools from DexScreener
 * and inserts only those NOT already in the database.
 *
 * Sources:
 *   1. DexScreener trending token profiles (boosted/most-active)
 *   2. DexScreener token search for popular categories
 *   3. DexScreener latest pairs on Solana
 *
 * Usage:
 *   npx tsx scripts/add-pools.ts
 *   npx tsx scripts/add-pools.ts --dry-run   # preview without inserting
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import mysql from "mysql2/promise";

// ─── Config ───────────────────────────────────────────────────────────

const DB_CONFIG = {
  host: process.env.TIDB_HOST,
  port: Number(process.env.TIDB_PORT || "4000"),
  user: process.env.TIDB_USER,
  password: process.env.TIDB_PASSWORD,
  database: process.env.TIDB_DATABASE,
  ssl:
    (process.env.TIDB_SSL ?? "true").toLowerCase() === "true"
      ? { minVersion: "TLSv1.2" as const, rejectUnauthorized: true }
      : undefined,
};

const DRY_RUN = process.argv.includes("--dry-run");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── DexScreener API helpers ──────────────────────────────────────────

interface DexPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceUsd: string;
  priceNative?: string;
  volume: { m5?: number; h1?: number; h6?: number; h24?: number };
  txns: {
    m5?: { buys: number; sells: number };
    h1?: { buys: number; sells: number };
    h6?: { buys: number; sells: number };
    h24?: { buys: number; sells: number };
  };
  priceChange: { m5?: number; h1?: number; h6?: number; h24?: number };
  liquidity?: { usd?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  info?: { imageUrl?: string };
}

async function fetchJSON(url: string): Promise<any> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`  HTTP ${res.status} for ${url}`);
      return null;
    }
    return res.json();
  } catch (err: any) {
    console.warn(`  Fetch error for ${url}: ${err.message}`);
    return null;
  }
}

/** 1. DexScreener token boosted/trending profiles */
async function fetchBoostedTokens(): Promise<string[]> {
  console.log("📡 Fetching boosted token profiles...");
  const data = await fetchJSON("https://api.dexscreener.com/token-boosts/top/v1");
  if (!data || !Array.isArray(data)) return [];
  const addresses = data
    .filter((t: any) => t.chainId === "solana")
    .map((t: any) => t.tokenAddress as string);
  console.log(`   Found ${addresses.length} boosted Solana tokens`);
  return [...new Set(addresses)];
}

/** 2. DexScreener latest pairs on Solana */
async function fetchLatestPairs(): Promise<DexPair[]> {
  console.log("📡 Fetching latest Solana pairs...");
  const data = await fetchJSON("https://api.dexscreener.com/latest/dex/pairs/solana");
  if (!data?.pairs) return [];
  const pairs = (data.pairs as DexPair[]).filter((p) => p.chainId === "solana");
  console.log(`   Found ${pairs.length} latest pairs`);
  return pairs;
}

/** 3. Search DexScreener for popular token categories */
async function searchTokens(query: string): Promise<DexPair[]> {
  console.log(`📡 Searching DexScreener for "${query}"...`);
  const data = await fetchJSON(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`);
  if (!data?.pairs) return [];
  const pairs = (data.pairs as DexPair[]).filter((p) => p.chainId === "solana");
  console.log(`   Found ${pairs.length} Solana pairs for "${query}"`);
  return pairs;
}

/** 4. Fetch pairs for specific token addresses */
async function fetchPairsForTokens(tokenAddresses: string[], poolsPerToken = 3): Promise<DexPair[]> {
  const allPairs: DexPair[] = [];
  for (let i = 0; i < tokenAddresses.length; i++) {
    const addr = tokenAddresses[i];
    if ((i + 1) % 20 === 0 || i === 0) {
      console.log(`   Fetching pools for token ${i + 1}/${tokenAddresses.length}...`);
    }
    const data = await fetchJSON(`https://api.dexscreener.com/latest/dex/tokens/${addr}`);
    if (data?.pairs) {
      const solanaPairs = (data.pairs as DexPair[])
        .filter((p) => p.chainId === "solana")
        .sort((a, b) => (b.volume?.h24 ?? 0) - (a.volume?.h24 ?? 0))
        .slice(0, poolsPerToken);
      allPairs.push(...solanaPairs);
    }
    if (i < tokenAddresses.length - 1) await sleep(350);
  }
  return allPairs;
}

/** 6. Fetch Jupiter verified token list for broad coverage */
async function fetchJupiterTokens(limit = 500): Promise<string[]> {
  console.log(`📡 Fetching top ${limit} Jupiter tokens...`);
  // Try multiple Jupiter API endpoints
  let data = await fetchJSON("https://token.jup.ag/all");
  if (!data) data = await fetchJSON("https://cache.jup.ag/tokens");
  if (!data) data = await fetchJSON("https://api.jup.ag/tokens/v1/tagged/verified");
  if (!data || !Array.isArray(data)) return [];
  // Filter out native SOL wrapper and stablecoins, take top N
  const skip = new Set([
    "So11111111111111111111111111111111111111112",
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
    "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
  ]);
  const addresses = data
    .filter((t: any) => !skip.has(t.address))
    .slice(0, limit)
    .map((t: any) => t.address as string);
  console.log(`   Got ${addresses.length} Jupiter tokens`);
  return addresses;
}

/** 5. Fetch trending pairs via token-profiles endpoint */
async function fetchTrendingTokenProfiles(): Promise<string[]> {
  console.log("📡 Fetching trending token profiles...");
  const data = await fetchJSON("https://api.dexscreener.com/token-profiles/latest/v1");
  if (!data || !Array.isArray(data)) return [];
  const addresses = data
    .filter((t: any) => t.chainId === "solana")
    .map((t: any) => t.tokenAddress as string);
  console.log(`   Found ${addresses.length} profile tokens`);
  return [...new Set(addresses)];
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log(DRY_RUN ? "🔍 DRY RUN — no data will be inserted\n" : "🚀 Adding new pools...\n");

  const pool = mysql.createPool(DB_CONFIG);

  // Step 1: Get existing pool addresses
  console.log("📊 Loading existing pool addresses...");
  const [existingRows] = await pool.query("SELECT address FROM pools");
  const existingAddresses = new Set((existingRows as any[]).map((r) => r.address));
  console.log(`   ${existingAddresses.size} pools already in DB\n`);

  // Step 2: Collect candidate pairs from multiple sources
  const allCandidates: DexPair[] = [];
  const seenAddresses = new Set<string>();

  // Source A: Boosted tokens → fetch their pools
  const boostedTokens = await fetchBoostedTokens();
  await sleep(500);

  // Source B: Trending profiles → fetch their pools
  const profileTokens = await fetchTrendingTokenProfiles();
  await sleep(500);

  // Combine unique token addresses and fetch pools
  const dexScreenerTokens = [...new Set([...boostedTokens, ...profileTokens])];
  console.log(`\n📡 Fetching pools for ${dexScreenerTokens.length} DexScreener tokens...`);
  const tokenPairs = await fetchPairsForTokens(dexScreenerTokens, 5);
  allCandidates.push(...tokenPairs);
  await sleep(500);

  // Source C: Jupiter verified token list (broad coverage)
  const jupiterTokens = await fetchJupiterTokens(400);
  // Remove tokens we already fetched from DexScreener
  const jupOnlyTokens = jupiterTokens.filter((a) => !dexScreenerTokens.includes(a));
  console.log(`\n📡 Fetching pools for ${jupOnlyTokens.length} Jupiter-only tokens...`);
  const jupPairs = await fetchPairsForTokens(jupOnlyTokens, 3);
  allCandidates.push(...jupPairs);
  await sleep(500);

  // Source D: Search popular categories (expanded)
  const searchQueries = [
    // Meme/culture
    "meme", "pepe", "doge", "shiba", "bonk", "wif", "popcat", "brett",
    // AI/tech
    "AI", "GPT", "agent", "neural", "compute",
    // DeFi
    "defi", "swap", "lend", "yield", "stake", "liquid",
    // Gaming/metaverse
    "gaming", "play", "nft", "metaverse",
    // Categories
    "RWA", "depin", "social", "dao", "governance",
    // Animals
    "cat", "dog", "frog", "bird", "ape", "bear", "bull",
    // Solana ecosystem
    "jupiter", "raydium", "orca", "marinade", "jito", "tensor", "pyth",
    // Trending themes
    "trump", "elon", "moon", "rocket", "gold", "bitcoin", "eth",
    // Infrastructure
    "bridge", "oracle", "layer", "chain",
    // More memes/culture
    "wojak", "chad", "sigma", "giga", "based", "cope", "snek", "hamster",
    "panda", "whale", "shark", "dragon", "phoenix", "wolf",
    // Finance
    "usdc", "usdt", "wrapped", "staked",
    // More ecosystems
    "solana", "helium", "render", "hivemapper", "shadow", "nosana",
    "parcl", "kamino", "drift", "zeta", "mango", "serum",
    "wormhole", "sanctum", "marginfi", "flashtrade",
  ];
  for (const q of searchQueries) {
    const pairs = await searchTokens(q);
    allCandidates.push(...pairs);
    await sleep(350);
  }

  // Source E: Latest pairs
  const latestPairs = await fetchLatestPairs();
  allCandidates.push(...latestPairs);

  // Step 3: Deduplicate and filter out existing pools
  const newPairs: DexPair[] = [];
  for (const pair of allCandidates) {
    if (existingAddresses.has(pair.pairAddress)) continue;
    if (seenAddresses.has(pair.pairAddress)) continue;
    // Filter: must have some volume or liquidity to be worth tracking
    if ((pair.volume?.h24 ?? 0) < 1 && (pair.liquidity?.usd ?? 0) < 100) continue;
    seenAddresses.add(pair.pairAddress);
    newPairs.push(pair);
  }

  console.log(`\n✅ Found ${newPairs.length} new pools (not in DB)`);

  if (newPairs.length === 0) {
    console.log("Nothing to add!");
    await pool.end();
    return;
  }

  // Show preview
  const byDex: Record<string, number> = {};
  for (const p of newPairs) {
    byDex[p.dexId] = (byDex[p.dexId] || 0) + 1;
  }
  console.log("\nBreakdown by DEX:");
  for (const [dex, count] of Object.entries(byDex).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${dex}: ${count}`);
  }

  // Top 10 by volume
  const topByVol = [...newPairs].sort((a, b) => (b.volume?.h24 ?? 0) - (a.volume?.h24 ?? 0)).slice(0, 10);
  console.log("\nTop 10 new pools by 24h volume:");
  for (const p of topByVol) {
    const vol = (p.volume?.h24 ?? 0);
    const volStr = vol >= 1e6 ? `$${(vol / 1e6).toFixed(1)}M` : vol >= 1e3 ? `$${(vol / 1e3).toFixed(1)}K` : `$${vol.toFixed(0)}`;
    console.log(`   ${p.baseToken.symbol}/${p.quoteToken.symbol} on ${p.dexId} — Vol ${volStr}`);
  }

  if (DRY_RUN) {
    console.log("\n🔍 Dry run complete. Use without --dry-run to insert.");
    await pool.end();
    return;
  }

  // Step 4: Insert new pools
  console.log(`\n💾 Inserting ${newPairs.length} pools...`);
  let inserted = 0;
  const BATCH = 50;

  for (let i = 0; i < newPairs.length; i += BATCH) {
    const batch = newPairs.slice(i, i + BATCH);
    const values = batch.map((p) => [
      p.pairAddress,
      p.dexId,
      p.baseToken.symbol,
      p.baseToken.address,
      p.quoteToken.symbol,
      p.quoteToken.address,
      Number(p.priceUsd) || 0,
      p.priceChange?.m5 ?? 0,
      p.priceChange?.h1 ?? 0,
      p.priceChange?.h6 ?? 0,
      p.priceChange?.h24 ?? 0,
      p.volume?.m5 ?? 0,
      p.volume?.h1 ?? 0,
      p.volume?.h6 ?? 0,
      p.volume?.h24 ?? 0,
      p.liquidity?.usd ?? 0,
      p.marketCap ?? p.fdv ?? 0,
      p.fdv ?? 0,
      p.txns?.m5?.buys ?? 0,
      p.txns?.m5?.sells ?? 0,
      p.txns?.h1?.buys ?? 0,
      p.txns?.h1?.sells ?? 0,
      p.txns?.h24?.buys ?? 0,
      p.txns?.h24?.sells ?? 0,
      p.pairCreatedAt ? new Date(p.pairCreatedAt) : null,
    ]);

    await pool.query(
      `INSERT IGNORE INTO pools (
        address, dex, token_base_symbol, token_base_address,
        token_quote_symbol, token_quote_address, price_usd,
        price_change_5m, price_change_1h, price_change_6h, price_change_24h,
        volume_5m, volume_1h, volume_6h, volume_24h,
        liquidity_usd, market_cap, fdv,
        txns_5m_buys, txns_5m_sells, txns_1h_buys, txns_1h_sells,
        txns_24h_buys, txns_24h_sells, pool_created_at
      ) VALUES ?`,
      [values]
    );
    inserted += batch.length;
    process.stdout.write(`\r   ${inserted}/${newPairs.length} pools inserted`);
  }
  console.log();

  // Step 5: Insert new tokens
  console.log("💾 Upserting tokens...");
  const tokenMap = new Map<string, { address: string; name: string; symbol: string; chainId: string }>();
  for (const p of newPairs) {
    if (!tokenMap.has(p.baseToken.address)) {
      tokenMap.set(p.baseToken.address, { ...p.baseToken, chainId: p.chainId });
    }
    if (!tokenMap.has(p.quoteToken.address)) {
      tokenMap.set(p.quoteToken.address, { ...p.quoteToken, chainId: p.chainId });
    }
  }

  const tokenValues = [...tokenMap.values()].map((t) => [
    t.address,
    t.name,
    t.symbol,
    `https://cdn.dexscreener.com/tokens/${t.chainId}/${t.address}.png`,
  ]);

  for (let i = 0; i < tokenValues.length; i += BATCH) {
    const batch = tokenValues.slice(i, i + BATCH);
    await pool.query(
      `INSERT IGNORE INTO tokens (address, name, symbol, logo_url) VALUES ?`,
      [batch]
    );
  }
  console.log(`   ${tokenValues.length} tokens upserted`);

  // Final summary
  const [countRows] = await pool.query("SELECT COUNT(*) as cnt FROM pools");
  const totalPools = (countRows as any[])[0].cnt;
  console.log(`\n🎉 Done! Total pools in DB: ${totalPools} (added ${newPairs.length})`);

  await pool.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
