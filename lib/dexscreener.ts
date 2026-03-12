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
