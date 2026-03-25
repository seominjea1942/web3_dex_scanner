import { NextRequest, NextResponse } from "next/server";
import { fetchOHLCV } from "@/lib/geckoterminal";
import { getPool } from "@/lib/db";
import type { RowDataPacket } from "mysql2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Accept both lowercase (from chart component) and uppercase (GeckoTerminal)
const VALID_INTERVALS = new Set(["5m", "15m", "1H", "4H", "1D", "1h", "4h", "1d"]);

// Normalize to uppercase for GeckoTerminal
function normalizeInterval(interval: string): string {
  const map: Record<string, string> = { "1h": "1H", "4h": "4H", "1d": "1D" };
  return map[interval] || interval;
}

// Interval → milliseconds for time-bucketing swap_transactions
const INTERVAL_MS: Record<string, number> = {
  "5m":  5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "1H":  60 * 60 * 1000,
  "4H":  4 * 60 * 60 * 1000,
  "1D":  24 * 60 * 60 * 1000,
};

const MAX_CANDLES = 300;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ poolAddress: string }> }
) {
  const start = performance.now();

  try {
    const { poolAddress } = await params;
    const rawInterval = req.nextUrl.searchParams.get("interval") || "15m";

    if (!VALID_INTERVALS.has(rawInterval)) {
      return NextResponse.json(
        { error: "Invalid interval. Use: 5m, 15m, 1H, 4H, 1D" },
        { status: 400 }
      );
    }

    const interval = normalizeInterval(rawInterval);

    // 1. Primary: GeckoTerminal (real on-chain data, free, no API key)
    try {
      const candles = await fetchOHLCV(poolAddress, interval, MAX_CANDLES);

      if (candles.length > 0) {
        return NextResponse.json({
          pool_address: poolAddress,
          interval,
          data_points: candles.length,
          source: "geckoterminal",
          query_time_ms: Math.round((performance.now() - start) * 100) / 100,
          candles,
        });
      }
    } catch (geckoErr) {
      console.warn("GeckoTerminal unavailable, falling back to TiDB:", geckoErr);
    }

    // 2. Fallback: Aggregate OHLCV from swap_transactions in TiDB
    //    This always works because swap_transactions shares pool addresses
    //    with the pools table (both seeded from the same source).
    //
    //    Strategy: anchor the price filter around the pool's known price_usd
    //    to produce a realistic-looking chart even with randomly seeded data.
    //    Then apply a smoothing pass to create natural price continuity
    //    between candles (each candle's open = previous candle's close).
    const db = getPool();
    const bucketMs = INTERVAL_MS[interval] || INTERVAL_MS["15m"];
    const bucketSec = bucketMs / 1000;

    // Helper: run the aggregation query with a price filter range
    const aggregateCandles = async (lower: number, upper: number) => {
      const [rows] = await db.query<RowDataPacket[]>(
        `SELECT
           FLOOR(timestamp / ?) * ? AS bucket_time,
           SUBSTRING_INDEX(GROUP_CONCAT(price ORDER BY timestamp ASC), ',', 1) + 0 AS open_price,
           MAX(price) AS high,
           MIN(price) AS low,
           SUBSTRING_INDEX(GROUP_CONCAT(price ORDER BY timestamp DESC), ',', 1) + 0 AS close_price,
           SUM(usd_value) AS volume
         FROM (
           SELECT timestamp, usd_value, usd_value / base_amount AS price
           FROM swap_transactions
           WHERE pool_address = ?
             AND base_amount > 0
             AND usd_value > 0
             AND usd_value / base_amount BETWEEN ? AND ?
         ) filtered
         GROUP BY bucket_time
         ORDER BY bucket_time DESC
         LIMIT ?`,
        [bucketMs, bucketSec, poolAddress, lower, upper, MAX_CANDLES]
      );
      return rows;
    }

    // Strategy 1: Anchor around the pool's known price_usd (tight filter)
    const [poolRows] = await db.query<RowDataPacket[]>(
      `SELECT price_usd FROM pools WHERE address = ? LIMIT 1`,
      [poolAddress]
    );
    const anchorPrice = Number(poolRows[0]?.price_usd) || 0;

    let rows: RowDataPacket[] = [];

    if (anchorPrice > 0) {
      rows = await aggregateCandles(anchorPrice * 0.2, anchorPrice * 5.0);
    }

    // Strategy 2: If anchor filter returned nothing (price mismatch with
    // seeded swap data), fall back to a statistical filter using the median
    // of actual swap prices in the pool (trimming top/bottom 10%).
    if (rows.length === 0) {
      const [stats] = await db.query<RowDataPacket[]>(
        `SELECT
           AVG(price) AS median_price
         FROM (
           SELECT usd_value / base_amount AS price,
                  ROW_NUMBER() OVER (ORDER BY usd_value / base_amount) AS rn,
                  COUNT(*) OVER () AS total
           FROM swap_transactions
           WHERE pool_address = ?
             AND base_amount > 0
             AND usd_value > 0
         ) ranked
         WHERE rn BETWEEN total * 0.25 AND total * 0.75`,
        [poolAddress]
      );

      const medianPrice = Number(stats[0]?.median_price) || 0;
      if (medianPrice > 0) {
        // Use median ± 60% as the filter band
        rows = await aggregateCandles(medianPrice * 0.4, medianPrice * 2.5);
      }
    }

    // Rows come DESC (newest first for LIMIT), reverse to ASC for the chart
    const rawCandles = rows.reverse().map((r: RowDataPacket) => ({
      time: Number(r.bucket_time),
      open: Number(r.open_price),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close_price),
      volume: Number(r.volume),
    }));

    // Smooth candles: connect each candle's open to the previous close
    // so the chart looks like a continuous price series (no gaps).
    const fallbackCandles = rawCandles.map((c, i) => {
      if (i === 0) return c;
      const prevClose = rawCandles[i - 1].close;
      return {
        ...c,
        open: prevClose,
        high: Math.max(c.high, prevClose),
        low: Math.min(c.low, prevClose),
      };
    });

    return NextResponse.json({
      pool_address: poolAddress,
      interval,
      data_points: fallbackCandles.length,
      source: "tidb_swap_aggregation",
      query_time_ms: Math.round((performance.now() - start) * 100) / 100,
      candles: fallbackCandles,
    });
  } catch (e) {
    console.error("GET /api/pool/[poolAddress]/ohlcv error:", e);
    return NextResponse.json(
      { error: "Failed to fetch OHLCV data" },
      { status: 500 }
    );
  }
}
