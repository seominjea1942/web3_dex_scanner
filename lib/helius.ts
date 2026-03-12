import { TOP_TOKENS_FOR_HELIUS } from "./constants";

interface HeliusTransaction {
  signature: string;
  type: string;
  source: string;
  fee: number;
  timestamp: number;
  nativeTransfers?: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    amount: number;
  }>;
  tokenTransfers?: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    mint: string;
    tokenAmount: number;
    tokenStandard: string;
  }>;
  description?: string;
  events?: {
    swap?: {
      nativeInput?: { account: string; amount: string };
      nativeOutput?: { account: string; amount: string };
      tokenInputs?: Array<{
        userAccount: string;
        tokenAccount: string;
        mint: string;
        rawTokenAmount: { tokenAmount: string; decimals: number };
      }>;
      tokenOutputs?: Array<{
        userAccount: string;
        tokenAccount: string;
        mint: string;
        rawTokenAmount: { tokenAmount: string; decimals: number };
      }>;
    };
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchHeliusEvents(apiKey: string) {
  const templates: Array<{
    event_type: "swap" | "whale" | "new_pool" | "liquidity" | "smart_money";
    token_symbol: string;
    token_logo_url: string;
    description_template: string;
    wallet_address: string;
    amount_usd: number;
    dex_name: string;
    tx_hash: string;
  }> = [];

  for (const token of TOP_TOKENS_FOR_HELIUS) {
    console.log(`  Fetching Helius events for ${token.symbol}...`);

    const url = `https://api.helius.xyz/v0/addresses/${token.address}/transactions?api-key=${apiKey}&limit=20`;
    const res = await fetch(url);

    if (!res.ok) {
      console.warn(
        `  Helius error for ${token.symbol}: ${res.status} ${res.statusText}`
      );
      await sleep(1000);
      continue;
    }

    const txns: HeliusTransaction[] = await res.json();
    console.log(
      `  Got ${txns.length} transactions for ${token.symbol}`
    );

    for (const tx of txns) {
      const template = classifyTransaction(tx, token.symbol);
      if (template) {
        templates.push(template);
      }
    }

    // Respect 10 RPS limit
    await sleep(200);
  }

  console.log(`  Collected ${templates.length} event templates from Helius`);
  return templates;
}

function classifyTransaction(
  tx: HeliusTransaction,
  tokenSymbol: string
): {
  event_type: "swap" | "whale" | "new_pool" | "liquidity" | "smart_money";
  token_symbol: string;
  token_logo_url: string;
  description_template: string;
  wallet_address: string;
  amount_usd: number;
  dex_name: string;
  tx_hash: string;
} | null {
  const source = tx.source || "Unknown";
  const dexName = mapSourceToDex(source);

  // Estimate USD amount from native transfers (rough: 1 SOL ~ $150)
  const solAmount =
    (tx.nativeTransfers ?? []).reduce((sum, t) => sum + t.amount, 0) / 1e9;
  const estimatedUsd = solAmount * 150;

  if (estimatedUsd < 10) return null; // skip dust

  const walletAddress =
    tx.nativeTransfers?.[0]?.fromUserAccount ?? "Unknown";

  let eventType: "swap" | "whale" | "new_pool" | "liquidity" | "smart_money" =
    "swap";
  let descTemplate = `swapped {amount} ${tokenSymbol} \${usd} via ${dexName}`;

  if (estimatedUsd > 25000) {
    eventType = "whale";
    descTemplate = `whale bought {amount} ${tokenSymbol} \${usd} via ${dexName}`;
  } else if (
    tx.type === "CREATE_ACCOUNT" ||
    tx.type === "INITIALIZE_ACCOUNT"
  ) {
    eventType = "new_pool";
    descTemplate = `new ${tokenSymbol}/SOL pool created on ${dexName}`;
  } else if (tx.type === "TRANSFER" && solAmount > 5) {
    eventType = "liquidity";
    descTemplate = `added \${usd} liquidity to ${tokenSymbol} on ${dexName}`;
  }

  return {
    event_type: eventType,
    token_symbol: tokenSymbol,
    token_logo_url: "",
    description_template: descTemplate,
    wallet_address: walletAddress,
    amount_usd: Math.round(estimatedUsd * 100) / 100,
    dex_name: dexName,
    tx_hash: tx.signature,
  };
}

function mapSourceToDex(source: string): string {
  const map: Record<string, string> = {
    RAYDIUM: "Raydium",
    ORCA: "Orca",
    JUPITER: "Jupiter",
    METEORA: "Meteora",
    PHOENIX: "Phoenix",
    OPENBOOK: "OpenBook",
    LIFINITY: "Lifinity",
  };
  return map[source.toUpperCase()] ?? source;
}

// Fallback: generate synthetic event templates if Helius is unavailable
export function generateSyntheticTemplates() {
  const dexes = ["Raydium", "Orca", "Jupiter", "Meteora"];
  const tokens = [
    { symbol: "BONK", logo: "" },
    { symbol: "WIF", logo: "" },
    { symbol: "JUP", logo: "" },
    { symbol: "RAY", logo: "" },
    { symbol: "POPCAT", logo: "" },
    { symbol: "SOL", logo: "" },
    { symbol: "PYTH", logo: "" },
    { symbol: "JTO", logo: "" },
    { symbol: "W", logo: "" },
    { symbol: "RENDER", logo: "" },
  ];

  const templates: Array<{
    event_type: "swap" | "whale" | "new_pool" | "liquidity" | "smart_money";
    token_symbol: string;
    token_logo_url: string;
    description_template: string;
    wallet_address: string;
    amount_usd: number;
    dex_name: string;
    tx_hash: string;
  }> = [];

  // Swap templates
  for (let i = 0; i < 20; i++) {
    const token = tokens[i % tokens.length];
    const dex = dexes[i % dexes.length];
    const amount = Math.floor(Math.random() * 50000) + 10000;
    templates.push({
      event_type: "swap",
      token_symbol: token.symbol,
      token_logo_url: token.logo,
      description_template: `bought {amount} ${token.symbol} \${usd} via ${dex}`,
      wallet_address: generateRandomAddress(),
      amount_usd: amount,
      dex_name: dex,
      tx_hash: generateRandomHash(),
    });
  }

  // Whale templates
  for (let i = 0; i < 8; i++) {
    const token = tokens[i % tokens.length];
    const dex = dexes[i % dexes.length];
    const amount = Math.floor(Math.random() * 500000) + 50000;
    templates.push({
      event_type: "whale",
      token_symbol: token.symbol,
      token_logo_url: token.logo,
      description_template: `whale bought {amount} ${token.symbol} \${usd} via ${dex}`,
      wallet_address: generateRandomAddress(),
      amount_usd: amount,
      dex_name: dex,
      tx_hash: generateRandomHash(),
    });
  }

  // Liquidity templates
  for (let i = 0; i < 8; i++) {
    const token = tokens[i % tokens.length];
    const dex = dexes[i % dexes.length];
    const amount = Math.floor(Math.random() * 200000) + 5000;
    templates.push({
      event_type: "liquidity",
      token_symbol: token.symbol,
      token_logo_url: token.logo,
      description_template: `added \${usd} liquidity to ${token.symbol} on ${dex}`,
      wallet_address: generateRandomAddress(),
      amount_usd: amount,
      dex_name: dex,
      tx_hash: generateRandomHash(),
    });
  }

  // New pool templates
  for (let i = 0; i < 5; i++) {
    const token = tokens[i % tokens.length];
    const dex = dexes[i % dexes.length];
    templates.push({
      event_type: "new_pool",
      token_symbol: token.symbol,
      token_logo_url: token.logo,
      description_template: `new ${token.symbol}/SOL pool created on ${dex}`,
      wallet_address: generateRandomAddress(),
      amount_usd: Math.floor(Math.random() * 100000) + 10000,
      dex_name: dex,
      tx_hash: generateRandomHash(),
    });
  }

  // Smart money templates
  for (let i = 0; i < 5; i++) {
    const token = tokens[i % tokens.length];
    const dex = dexes[i % dexes.length];
    const amount = Math.floor(Math.random() * 300000) + 25000;
    templates.push({
      event_type: "smart_money",
      token_symbol: token.symbol,
      token_logo_url: token.logo,
      description_template: `smart money bought {amount} ${token.symbol} \${usd} via ${dex}`,
      wallet_address: generateRandomAddress(),
      amount_usd: amount,
      dex_name: dex,
      tx_hash: generateRandomHash(),
    });
  }

  return templates;
}

function generateRandomAddress(): string {
  const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let result = "";
  for (let i = 0; i < 44; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

function generateRandomHash(): string {
  const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let result = "";
  for (let i = 0; i < 88; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}
