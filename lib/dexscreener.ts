export interface DexScreenerPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  labels?: string[];
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceNative: string;
  priceUsd: string;
  txns: {
    m5?: { buys: number; sells: number };
    h1?: { buys: number; sells: number };
    h6?: { buys: number; sells: number };
    h24?: { buys: number; sells: number };
  };
  volume: {
    m5?: number;
    h1?: number;
    h6?: number;
    h24?: number;
  };
  priceChange: {
    m5?: number;
    h1?: number;
    h6?: number;
    h24?: number;
  };
  liquidity?: {
    usd?: number;
    base?: number;
    quote?: number;
  };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  info?: {
    imageUrl?: string;
  };
}

interface DexScreenerResponse {
  pairs: DexScreenerPair[] | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchPoolsForToken(
  tokenAddress: string
): Promise<DexScreenerPair[]> {
  const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`  DexScreener error for ${tokenAddress}: ${res.status}`);
    return [];
  }

  const data: DexScreenerResponse = await res.json();
  return data.pairs ?? [];
}

// ── Mapping helpers ──────────────────────────────────────────

export function mapPairToPoolRow(pair: DexScreenerPair) {
  return {
    address: pair.pairAddress,
    token_base_address: pair.baseToken.address,
    token_quote_address: pair.quoteToken.address,
    token_base_symbol: pair.baseToken.symbol,
    token_quote_symbol: pair.quoteToken.symbol,
    dex: pair.dexId,
    price_usd: Number(pair.priceUsd) || 0,
    volume_5m: pair.volume?.m5 ?? 0,
    volume_1h: pair.volume?.h1 ?? 0,
    volume_6h: pair.volume?.h6 ?? 0,
    volume_24h: pair.volume?.h24 ?? 0,
    liquidity_usd: pair.liquidity?.usd ?? 0,
    // Use marketCap if available, fall back to fdv
    market_cap: pair.marketCap ?? pair.fdv ?? 0,
    txns_5m_buys: pair.txns?.m5?.buys ?? 0,
    txns_5m_sells: pair.txns?.m5?.sells ?? 0,
    txns_1h_buys: pair.txns?.h1?.buys ?? 0,
    txns_1h_sells: pair.txns?.h1?.sells ?? 0,
    txns_24h_buys: pair.txns?.h24?.buys ?? 0,
    txns_24h_sells: pair.txns?.h24?.sells ?? 0,
    price_change_5m: pair.priceChange?.m5 ?? 0,
    price_change_1h: pair.priceChange?.h1 ?? 0,
    price_change_6h: pair.priceChange?.h6 ?? 0,
    price_change_24h: pair.priceChange?.h24 ?? 0,
    pool_created_at: pair.pairCreatedAt ? new Date(pair.pairCreatedAt) : null,
  };
}

export function mapPairToTokenRow(pair: DexScreenerPair, side: "base" | "quote") {
  const token = side === "base" ? pair.baseToken : pair.quoteToken;
  // Use DexScreener token logo CDN — pair.info?.imageUrl is the social banner, not the logo
  const logoUrl = `https://dd.dexscreener.com/ds-data/tokens/${pair.chainId}/${token.address}.png`;
  return {
    address: token.address,
    name: token.name,
    symbol: token.symbol,
    logo_url: logoUrl,
  };
}

// ── Fetch helpers ────────────────────────────────────────────

export async function fetchTrendingSolanaPairs(): Promise<DexScreenerPair[]> {
  try {
    const res = await fetch("https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112");
    if (!res.ok) return [];
    const data: DexScreenerResponse = await res.json();
    return (data.pairs ?? []).filter((p) => p.chainId === "solana").slice(0, 50);
  } catch {
    return [];
  }
}

export async function fetchPairsFromDexScreener(addresses: string[]): Promise<DexScreenerPair[]> {
  const allPairs: DexScreenerPair[] = [];
  // DexScreener supports comma-separated addresses (up to 30 per request)
  for (let i = 0; i < addresses.length; i += 30) {
    const batch = addresses.slice(i, i + 30);
    try {
      const res = await fetch(`https://api.dexscreener.com/latest/dex/pairs/solana/${batch.join(",")}`);
      if (!res.ok) continue;
      const data = await res.json();
      const pairs = data.pairs ?? (data.pair ? [data.pair] : []);
      allPairs.push(...pairs);
    } catch {
      continue;
    }
    if (i + 30 < addresses.length) await sleep(500);
  }
  return allPairs;
}

export async function fetchPoolsForTokens(
  tokenAddresses: string[],
  delayMs = 1000
): Promise<DexScreenerPair[]> {
  const allPairs: DexScreenerPair[] = [];

  for (let i = 0; i < tokenAddresses.length; i++) {
    const address = tokenAddresses[i];
    console.log(
      `  Fetching pools for token ${i + 1}/${tokenAddresses.length}: ${address.slice(0, 8)}...`
    );

    const pairs = await fetchPoolsForToken(address);
    // Take top 3 pools per token by volume
    const sorted = pairs
      .filter((p) => p.chainId === "solana")
      .sort((a, b) => (b.volume?.h24 ?? 0) - (a.volume?.h24 ?? 0))
      .slice(0, 3);

    allPairs.push(...sorted);

    if (i < tokenAddresses.length - 1) {
      await sleep(delayMs);
    }
  }

  return allPairs;
}
