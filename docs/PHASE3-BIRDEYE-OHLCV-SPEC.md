# Phase 3: Real OHLCV Candlestick Data via Birdeye

## Overview
Replace seeded price_history with real candlestick data from Birdeye API.
The chart on pool detail page will show real price action for any Solana token.

## Prerequisites
- Phase 1 merged (real pool data from DexScreener)
- Birdeye API key (free tier: 100 req/min) — sign up at https://birdeye.so/
- Branch: `feat/phase3-birdeye-ohlcv`

## Architecture

```
User opens pool detail page
        │
        ▼
Is OHLCV data stale? (>5 min for that pool + interval)
        │
     Yes ▼                    No ▼
Fetch Birdeye OHLCV ──▶   Serve from TiDB
        │
UPSERT into price_history
        │
Return candles to chart
```

## Environment Variables
```
BIRDEYE_API_KEY=your_key_here
```

## Free Tier Limits
- 100 requests/minute
- Our usage: 1 request per pool detail page load (when stale)
- Even at 50 page loads/min: 50% of limit ✅

## Step 1: Birdeye API Client

### File: `lib/birdeye.ts`

```typescript
const BIRDEYE_BASE = "https://public-api.birdeye.so";

interface BirdeyeCandle {
  o: number;  // open
  h: number;  // high
  l: number;  // low
  c: number;  // close
  v: number;  // volume
  unixTime: number;  // unix timestamp in seconds
}

interface BirdeyeOHLCVResponse {
  success: boolean;
  data: {
    items: BirdeyeCandle[];
  };
}

/**
 * Birdeye interval mapping:
 *   "1m", "3m", "5m", "15m", "30m", "1H", "2H", "4H", "6H", "8H", "12H", "1D", "3D", "1W", "1M"
 *
 * Our app intervals → Birdeye intervals:
 *   "5m"  → "5m"
 *   "15m" → "15m"
 *   "1H"  → "1H"
 *   "4H"  → "4H"
 *   "1D"  → "1D"
 */

const INTERVAL_MAP: Record<string, string> = {
  "5m": "5m",
  "15m": "15m",
  "1H": "1H",
  "4H": "4H",
  "1D": "1D",
};

export async function fetchOHLCV(
  tokenAddress: string,
  interval: string = "15m",
  candleCount: number = 300
): Promise<BirdeyeCandle[]> {
  const birdeyeInterval = INTERVAL_MAP[interval] || "15m";

  // Calculate time_from based on interval and candle count
  const now = Math.floor(Date.now() / 1000);
  const intervalSeconds: Record<string, number> = {
    "5m": 300,
    "15m": 900,
    "1H": 3600,
    "4H": 14400,
    "1D": 86400,
  };
  const seconds = intervalSeconds[interval] || 900;
  const timeFrom = now - seconds * candleCount;

  const url = `${BIRDEYE_BASE}/defi/ohlcv?` +
    `address=${tokenAddress}` +
    `&type=${birdeyeInterval}` +
    `&time_from=${timeFrom}` +
    `&time_to=${now}`;

  const res = await fetch(url, {
    headers: {
      "X-API-KEY": process.env.BIRDEYE_API_KEY || "",
      "x-chain": "solana",
    },
  });

  if (!res.ok) {
    console.warn(`Birdeye OHLCV error: ${res.status}`);
    return [];
  }

  const data: BirdeyeOHLCVResponse = await res.json();
  return data.data?.items ?? [];
}
```

## Step 2: Update OHLCV API Route

### File: `app/api/pool/[poolAddress]/ohlcv/route.ts`

Replace the current implementation that reads from seeded `price_history` with:

```typescript
import { fetchOHLCV } from "@/lib/birdeye";

export async function GET(req, { params }) {
  const { poolAddress } = await params;
  const interval = req.nextUrl.searchParams.get("interval") || "15m";

  const db = getPool();

  // 1. Get token address for this pool
  const [poolRows] = await db.query(
    "SELECT token_base_address FROM pools WHERE address = ?",
    [poolAddress]
  );
  if (poolRows.length === 0) return NextResponse.json({ error: "Pool not found" }, { status: 404 });

  const tokenAddress = poolRows[0].token_base_address;

  // 2. Check if we have fresh cached data
  const STALE_MS = 5 * 60 * 1000;
  const [cached] = await db.query(
    `SELECT MAX(recorded_at) as latest FROM price_history
     WHERE pool_address = ? AND interval_type = ?`,
    [poolAddress, interval]
  );
  const latest = cached[0]?.latest;
  const isFresh = latest && (Date.now() - new Date(latest).getTime() < STALE_MS);

  // 3. If stale, fetch from Birdeye and cache
  if (!isFresh) {
    const candles = await fetchOHLCV(tokenAddress, interval, 300);

    if (candles.length > 0) {
      // Batch UPSERT into price_history
      for (const c of candles) {
        await db.execute(
          `INSERT INTO price_history (pool_address, interval_type, timestamp, open, high, low, close, volume, recorded_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE
             open = VALUES(open), high = VALUES(high), low = VALUES(low),
             close = VALUES(close), volume = VALUES(volume), recorded_at = NOW()`,
          [poolAddress, interval, c.unixTime, c.o, c.h, c.l, c.c, c.v]
        );
      }
    }
  }

  // 4. Read from TiDB and return
  const [rows] = await db.query(
    `SELECT timestamp as time, open as o, high as h, low as l, close as c, volume as v
     FROM price_history
     WHERE pool_address = ? AND interval_type = ?
     ORDER BY timestamp ASC
     LIMIT 300`,
    [poolAddress, interval]
  );

  return NextResponse.json({ candles: rows, source: isFresh ? "cache" : "birdeye" });
}
```

## Step 3: Schema Update

### Add `interval_type` column and unique index:

```sql
-- Add interval_type to price_history if not exists
ALTER TABLE price_history ADD COLUMN interval_type VARCHAR(8) DEFAULT '15m';

-- Add unique constraint for dedup
ALTER TABLE price_history ADD UNIQUE INDEX idx_pool_interval_ts
  (pool_address, interval_type, timestamp);
```

Or if recreating:

```sql
CREATE TABLE IF NOT EXISTS price_history (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  pool_address VARCHAR(64),
  interval_type VARCHAR(8) DEFAULT '15m',
  timestamp BIGINT,
  open DECIMAL(20, 10),
  high DECIMAL(20, 10),
  low DECIMAL(20, 10),
  close DECIMAL(20, 10),
  volume DECIMAL(20, 2),
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE INDEX idx_pool_interval_ts (pool_address, interval_type, timestamp),
  INDEX idx_pool_ts (pool_address, timestamp)
);
```

## Step 4: Fallback Strategy

```typescript
// In the OHLCV route:
// 1. Try Birdeye
// 2. If fails, try DexScreener (they have basic OHLCV too, less granular)
// 3. If both fail, serve stale TiDB cache
// User never sees empty chart
```

DexScreener also has OHLCV but it's less documented. As backup:
```
GET https://api.dexscreener.com/latest/dex/pairs/solana/{pairAddress}
```
The response includes `priceChange` for 5m/1h/6h/24h but not full candlestick data.

## Step 5: Chart Component Update

### File: `components/pool-detail/CandlestickChart.tsx`

Minimal changes needed:
- The chart already supports the candle format `{ time, o, h, l, c, v }`
- Just ensure the API response maps correctly
- Add loading/error states if Birdeye is slow (can take 1-2s)

## Files Summary

| File | Action | Overlap risk |
|------|--------|-------------|
| `lib/birdeye.ts` | NEW | None |
| `app/api/pool/[poolAddress]/ohlcv/route.ts` | MODIFY | Low (Phase 1 doesn't touch this) |
| `db/schema-v2.sql` | MODIFY (add interval_type) | Low |
| `components/pool-detail/CandlestickChart.tsx` | MINOR tweak | Low |

## TiDB RU Impact

- Each OHLCV fetch: 300 INSERTs × ~8 RU = 2,400 RU
- Frequency: on page load, when stale (>5 min)
- Estimate: 500 page loads/day × 2,400 RU = 1.2M RU/day = 36M RU/month
- Combined with Phase 1: ~64M RU/month
- ⚠️ Getting close to 50M limit — may need to increase stale threshold to 10 min
- At 10 min stale: ~18M RU/month for OHLCV → total ~46M RU/month ✅

## Birdeye Free Tier
- 100 req/min
- At 500 page loads/day: ~0.35 req/min average ✅
- Peak: maybe 5 req/min during demo → still fine

## Estimated Implementation Time
- Human: 3-4 hours
- Claude Code: ~20-30 minutes
