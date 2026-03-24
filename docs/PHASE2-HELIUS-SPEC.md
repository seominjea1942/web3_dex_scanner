# Phase 2: Real-Time Transactions via Helius

## Overview
Replace fake transaction data with real Solana DEX swap events using Helius API.
Helius parses raw Solana transactions and delivers structured swap data via webhooks.

## Prerequisites
- Phase 1 must be merged to main first (real pool data from DexScreener)
- Create branch: `feat/phase2-helius`
- Helius API key (free tier: 100K credits/day) — sign up at https://www.helius.dev/

## Architecture

```
Solana Blockchain
      │
      ▼
Helius (parses DEX swaps)
      │
      ▼ webhook POST
/api/webhooks/helius/route.ts
      │
      ▼ INSERT
TiDB Cloud (swap_transactions + defi_events)
      │
      ▼ SELECT
App reads real data
```

## Environment Variables (add to .env.local)
```
HELIUS_API_KEY=your_key_here
HELIUS_WEBHOOK_SECRET=your_webhook_secret_here
```

## Step 1: Helius API Client

### File: `lib/helius.ts`

```typescript
const HELIUS_BASE = "https://api.helius.xyz/v0";

interface HeliusSwapEvent {
  signature: string;
  timestamp: number;
  type: "SWAP";
  source: string; // DEX name: "RAYDIUM", "ORCA", "JUPITER", etc.
  tokenInputs: Array<{
    mint: string;
    amount: number;
    tokenAccount: string;
  }>;
  tokenOutputs: Array<{
    mint: string;
    amount: number;
    tokenAccount: string;
  }>;
  fee: number;
  feePayer: string; // trader wallet
  nativeTransfers: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    amount: number; // in lamports
  }>;
  description: string;
}

export async function createWebhook(poolAddresses: string[]): Promise<string> {
  // POST to Helius to create/update webhook
  // Watch specific pool accounts for SWAP events
  const res = await fetch(`${HELIUS_BASE}/webhooks?api-key=${process.env.HELIUS_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      webhookURL: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/helius`,
      transactionTypes: ["SWAP"],
      accountAddresses: poolAddresses,
      webhookType: "enhanced",
    }),
  });
  const data = await res.json();
  return data.webhookID;
}

export function parseSwapToTransaction(event: HeliusSwapEvent) {
  // Map Helius enhanced transaction to our swap_transactions schema
  return {
    signature: event.signature,
    pool_address: "", // derive from token accounts
    trader_wallet: event.feePayer,
    side: "buy", // determine from token flow direction
    token_amount: 0, // from tokenInputs/tokenOutputs
    quote_amount: 0,
    usd_value: 0, // calculate from token price
    price_at_trade: 0,
    dex: event.source.toLowerCase(),
    trade_time: new Date(event.timestamp * 1000),
  };
}
```

## Step 2: Webhook Receiver

### File: `app/api/webhooks/helius/route.ts`

```typescript
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function POST(req: Request) {
  // 1. Verify webhook signature (optional but recommended)
  const body = await req.json();

  // body is an array of enhanced transactions
  const transactions = Array.isArray(body) ? body : [body];

  // 2. Filter for SWAP type only
  const swaps = transactions.filter((tx) => tx.type === "SWAP");
  if (swaps.length === 0) return NextResponse.json({ ok: true });

  // 3. Batch INSERT into swap_transactions
  const values: any[][] = [];
  for (const swap of swaps) {
    const parsed = parseSwapToTransaction(swap);
    values.push([
      parsed.signature,
      parsed.pool_address,
      parsed.trader_wallet,
      parsed.side,
      parsed.token_amount,
      parsed.quote_amount,
      parsed.usd_value,
      parsed.price_at_trade,
      parsed.dex,
      parsed.trade_time,
    ]);
  }

  // Use INSERT IGNORE to skip duplicates (signature is unique)
  const placeholders = values.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(",\n");
  const flat = values.flat();

  await pool.execute(
    `INSERT IGNORE INTO swap_transactions
     (signature, pool_address, trader_wallet, side, token_amount, quote_amount, usd_value, price_at_trade, dex, trade_time)
     VALUES ${placeholders}`,
    flat
  );

  // 4. Also insert into defi_events for the live ticker
  for (const swap of swaps) {
    const parsed = parseSwapToTransaction(swap);
    const desc = `${parsed.side} ${formatCompact(parsed.usd_value)} via ${parsed.dex}`;
    await pool.execute(
      `INSERT INTO defi_events (event_type, timestamp, pool_address, dex, severity, trader_wallet, usd_value, description)
       VALUES (?, NOW(), ?, ?, 'medium', ?, ?, ?)`,
      [parsed.side === "buy" ? "large_trade" : "large_trade", parsed.pool_address, parsed.dex, parsed.trader_wallet, parsed.usd_value, desc]
    );
  }

  return NextResponse.json({ ok: true, processed: swaps.length });
}
```

## Step 3: Webhook Registration Script

### File: `scripts/register-helius-webhook.ts`

```typescript
// One-time script to register webhook with Helius
// Run: npx tsx scripts/register-helius-webhook.ts

import { pool } from "../lib/db";

async function main() {
  // 1. Get top 50 pool addresses from TiDB
  const [rows] = await pool.execute(
    "SELECT pool_address FROM pools ORDER BY volume_24h DESC LIMIT 50"
  );

  const addresses = (rows as any[]).map((r) => r.pool_address);

  // 2. Register webhook with Helius
  const res = await fetch(
    `https://api.helius.xyz/v0/webhooks?api-key=${process.env.HELIUS_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        webhookURL: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/helius`,
        transactionTypes: ["SWAP"],
        accountAddresses: addresses,
        webhookType: "enhanced",
      }),
    }
  );

  const data = await res.json();
  console.log("Webhook registered:", data.webhookID);
  console.log("Watching", addresses.length, "pools");

  process.exit(0);
}

main().catch(console.error);
```

## Step 4: Remove Fake Event Replay

### File: `lib/event-replay.ts`
- Remove the `replayOneEvent()` function that generates fake events
- Remove the `insertMutatedEvent()` function
- Keep the file but export a no-op or remove entirely

### File: `app/api/events/route.ts`
- Remove the fake event generation on each API call
- Simply SELECT from defi_events (now populated by real webhook data)
- Keep the same response format

```typescript
export async function GET() {
  const [rows] = await pool.execute(
    `SELECT * FROM defi_events ORDER BY timestamp DESC LIMIT 50`
  );
  return NextResponse.json(rows);
}
```

## Step 5: Update Transaction Queries

### File: `app/api/pool/[poolAddress]/transactions/route.ts`
- No schema change needed — swap_transactions table already has the right columns
- Just ensure the query works with real data (signature-based dedup)
- Remove any mock data fallbacks

## Step 6: Derive Wallet Profiles (optional, enhances smart money feature)

After accumulating real transactions for a few hours/days, run:

```sql
-- Classify wallets based on trading behavior
INSERT INTO wallet_profiles (address, label, trade_count, total_volume, avg_trade_size, win_rate, last_active)
SELECT
  trader_wallet,
  CASE
    WHEN SUM(usd_value) > 100000 THEN 'whale'
    WHEN COUNT(*) > 50 AND SUM(usd_value) / COUNT(*) > 500 THEN 'smart_money'
    WHEN COUNT(*) > 200 THEN 'bot'
    ELSE 'retail'
  END AS label,
  COUNT(*),
  SUM(usd_value),
  AVG(usd_value),
  0.5, -- placeholder, needs PnL calculation
  MAX(trade_time)
FROM swap_transactions
GROUP BY trader_wallet
HAVING COUNT(*) >= 3
ON DUPLICATE KEY UPDATE
  label = VALUES(label),
  trade_count = VALUES(trade_count),
  total_volume = VALUES(total_volume),
  avg_trade_size = VALUES(avg_trade_size),
  last_active = VALUES(last_active);
```

## Deployment Notes

### Vercel
- Add `HELIUS_API_KEY` and `HELIUS_WEBHOOK_SECRET` to Vercel env vars
- Add `NEXT_PUBLIC_APP_URL` pointing to your Vercel URL (for webhook callback)
- The webhook URL must be publicly accessible — Helius sends POST requests to it

### Webhook URL
- Local dev: use ngrok (`ngrok http 3000`) for testing
- Production: `https://your-app.vercel.app/api/webhooks/helius`

### TiDB RU Impact
- Each webhook INSERT: ~10 RU
- Estimated volume: 100-500 swaps/hour for 50 pools = 24K-120K writes/day
- Monthly: ~0.7M-3.6M writes × 10 RU = 7-36M RU
- Combined with Phase 1: still under 50M RU free tier ✅

## Files Summary

| File | Action | Touches Phase 1? |
|------|--------|-------------------|
| `lib/helius.ts` | NEW | No |
| `app/api/webhooks/helius/route.ts` | NEW | No |
| `scripts/register-helius-webhook.ts` | NEW | No |
| `lib/event-replay.ts` | MODIFY (remove fake) | No |
| `app/api/events/route.ts` | MODIFY (read real) | No |
| `.env.local` | ADD 3 vars | Minor (just add lines) |

**Zero overlap with Phase 1 files.** Safe to develop in parallel on a separate branch.

## Testing

1. Start local dev server
2. Use ngrok to expose localhost: `ngrok http 3000`
3. Register webhook with ngrok URL
4. Open app — should see real swaps appearing in:
   - Transaction table on pool detail page
   - Live event ticker
   - SQL Console queries (whale trades, volume by DEX, etc.)

## Helius Free Tier Limits
- 100K credits/day
- Enhanced webhooks: 1 credit per transaction
- At 500 swaps/hour × 24h = 12K credits/day (12% of limit) ✅
