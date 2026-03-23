/**
 * Helius API client — webhook CRUD + swap transaction parsing.
 * Phase 2: Real-time transaction ingestion via Helius enhanced webhooks.
 */

const HELIUS_BASE = "https://api.helius.xyz/v0";

/* ── Types ──────────────────────────────────────────────────── */

export interface HeliusEnhancedTransaction {
  signature: string;
  timestamp: number;
  type: string;
  source: string; // DEX name: "RAYDIUM", "ORCA", "JUPITER", etc.
  fee: number;
  feePayer: string; // trader wallet
  description?: string;
  nativeTransfers?: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    amount: number; // lamports
  }>;
  tokenTransfers?: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    mint: string;
    tokenAmount: number;
    tokenStandard: string;
  }>;
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
      innerSwaps?: Array<{
        tokenInputs?: Array<{
          mint: string;
          rawTokenAmount: { tokenAmount: string; decimals: number };
        }>;
        tokenOutputs?: Array<{
          mint: string;
          rawTokenAmount: { tokenAmount: string; decimals: number };
        }>;
      }>;
    };
  };
}

export interface ParsedSwapTransaction {
  signature: string;
  pool_address: string;
  trader_wallet: string;
  side: "buy" | "sell";
  token_amount: number;
  quote_amount: number;
  usd_value: number;
  price_at_trade: number;
  dex: string;
  timestamp: number; // ms
}

/* ── Well-known quote tokens (stablecoins + SOL) ──────────── */

const QUOTE_MINTS = new Set([
  "So11111111111111111111111111111111111111112",  // Wrapped SOL
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
  "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj", // stSOL
  "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",  // mSOL
]);

// Rough SOL price for USD estimation (updated periodically in production)
const SOL_PRICE_USD = 150;

/* ── Webhook CRUD ───────────────────────────────────────────── */

export async function createWebhook(poolAddresses: string[]): Promise<string> {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) throw new Error("HELIUS_API_KEY not set");

  const res = await fetch(`${HELIUS_BASE}/webhooks?api-key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      webhookURL: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/helius`,
      transactionTypes: ["SWAP"],
      accountAddresses: poolAddresses,
      webhookType: "enhanced",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Helius createWebhook failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  return data.webhookID;
}

export async function listWebhooks() {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) throw new Error("HELIUS_API_KEY not set");

  const res = await fetch(`${HELIUS_BASE}/webhooks?api-key=${apiKey}`);
  if (!res.ok) throw new Error(`Helius listWebhooks failed: ${res.status}`);
  return res.json();
}

export async function deleteWebhook(webhookId: string) {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) throw new Error("HELIUS_API_KEY not set");

  const res = await fetch(`${HELIUS_BASE}/webhooks/${webhookId}?api-key=${apiKey}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Helius deleteWebhook failed: ${res.status}`);
  return true;
}

/* ── Parse enhanced swap → our schema ───────────────────────── */

export function parseSwapToTransaction(
  tx: HeliusEnhancedTransaction
): ParsedSwapTransaction | null {
  const swap = tx.events?.swap;
  if (!swap) return null;

  const trader = tx.feePayer;
  const dex = mapSourceToDex(tx.source);
  const timestamp = tx.timestamp * 1000; // seconds → ms

  // Determine buy/sell and amounts from token flow
  let side: "buy" | "sell" = "buy";
  let tokenAmount = 0;
  let quoteAmount = 0;
  let usdValue = 0;

  // Check native SOL input/output
  const nativeIn = swap.nativeInput
    ? Number(swap.nativeInput.amount) / 1e9
    : 0;
  const nativeOut = swap.nativeOutput
    ? Number(swap.nativeOutput.amount) / 1e9
    : 0;

  // Check token inputs/outputs
  const tokenIn = swap.tokenInputs?.[0];
  const tokenOut = swap.tokenOutputs?.[0];

  if (nativeIn > 0 && tokenOut) {
    // Spent SOL → got token = BUY
    side = "buy";
    quoteAmount = nativeIn;
    tokenAmount = parseTokenAmount(tokenOut.rawTokenAmount);
    usdValue = nativeIn * SOL_PRICE_USD;
  } else if (nativeOut > 0 && tokenIn) {
    // Got SOL → sold token = SELL
    side = "sell";
    quoteAmount = nativeOut;
    tokenAmount = parseTokenAmount(tokenIn.rawTokenAmount);
    usdValue = nativeOut * SOL_PRICE_USD;
  } else if (tokenIn && tokenOut) {
    // Token-to-token swap
    const inIsQuote = QUOTE_MINTS.has(tokenIn.mint);
    const outIsQuote = QUOTE_MINTS.has(tokenOut.mint);

    if (inIsQuote && !outIsQuote) {
      side = "buy";
      quoteAmount = parseTokenAmount(tokenIn.rawTokenAmount);
      tokenAmount = parseTokenAmount(tokenOut.rawTokenAmount);
    } else if (outIsQuote && !inIsQuote) {
      side = "sell";
      quoteAmount = parseTokenAmount(tokenOut.rawTokenAmount);
      tokenAmount = parseTokenAmount(tokenIn.rawTokenAmount);
    } else {
      side = "buy";
      tokenAmount = parseTokenAmount(tokenOut.rawTokenAmount);
      quoteAmount = parseTokenAmount(tokenIn.rawTokenAmount);
    }

    // For stablecoin quotes, USD ≈ quoteAmount
    if (inIsQuote || outIsQuote) {
      usdValue = quoteAmount;
    } else {
      usdValue = quoteAmount * SOL_PRICE_USD; // rough estimate
    }
  } else {
    // Can't determine amounts — use native transfer estimate
    const solTotal =
      (tx.nativeTransfers ?? []).reduce((s, t) => s + t.amount, 0) / 1e9;
    usdValue = solTotal * SOL_PRICE_USD;
    if (usdValue < 1) return null; // skip dust
  }

  if (usdValue < 1) return null; // skip dust transactions

  const priceAtTrade = tokenAmount > 0 ? usdValue / tokenAmount : 0;

  return {
    signature: tx.signature,
    pool_address: "", // pool address not directly in enhanced tx — derived in webhook
    trader_wallet: trader,
    side,
    token_amount: tokenAmount,
    quote_amount: quoteAmount,
    usd_value: Math.round(usdValue * 100) / 100,
    price_at_trade: priceAtTrade,
    dex,
    timestamp,
  };
}

/* ── Event type derivation ──────────────────────────────────── */

export function deriveEventType(
  parsed: ParsedSwapTransaction
): "whale" | "large_trade" | "smart_money" {
  if (parsed.usd_value >= 50000) return "whale";
  return "large_trade";
}

export function deriveSeverity(eventType: string): string {
  switch (eventType) {
    case "whale":
      return "high";
    case "smart_money":
      return "medium";
    case "large_trade":
    default:
      return "low";
  }
}

/* ── Helpers ────────────────────────────────────────────────── */

function parseTokenAmount(raw: { tokenAmount: string; decimals: number }): number {
  return Number(raw.tokenAmount) / Math.pow(10, raw.decimals);
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
  return map[source?.toUpperCase()] ?? source ?? "Unknown";
}

export function formatCompactUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}
