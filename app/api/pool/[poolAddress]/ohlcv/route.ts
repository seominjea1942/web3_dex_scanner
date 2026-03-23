import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import type { RowDataPacket } from "mysql2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Candle intervals: label → bucket size in ms
// The interval parameter controls candle granularity (like DEXScreener)
const INTERVAL_MS: Record<string, number> = {
  "3m":  3 * 60 * 1000,
  "5m":  5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "1h":  60 * 60 * 1000,
  "4h":  4 * 60 * 60 * 1000,
  "1d":  24 * 60 * 60 * 1000,
};

// How far back to fetch for each interval
// We fetch all data and let aggregation + MAX_CANDLES trim it,
// since seed data may span ~30 days with gaps
const LOOKBACK_MS: Record<string, number> = {
  "3m":  0,  // all data
  "5m":  0,  // all data
  "15m": 0,  // all data
  "1h":  0,  // all data
  "4h":  0,  // all data
  "1d":  0,  // all data
};

// Total candles to send — user can scroll left to see older ones
// The chart component controls the initial visible range (~80 candles)
const MAX_CANDLES = 300;

interface RawCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function aggregateCandles(candles: RawCandle[], bucketMs: number): RawCandle[] {
  if (candles.length === 0) return candles;

  const bucketSec = bucketMs / 1000;
  const buckets = new Map<number, RawCandle>();

  for (const c of candles) {
    const key = Math.floor(c.time / bucketSec) * bucketSec;
    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, { ...c, time: key });
    } else {
      existing.high = Math.max(existing.high, c.high);
      existing.low = Math.min(existing.low, c.low);
      existing.close = c.close; // last close wins
      existing.volume += c.volume;
    }
  }

  return Array.from(buckets.values()).sort((a, b) => a.time - b.time);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ poolAddress: string }> }
) {
  const start = performance.now();

  try {
    const { poolAddress } = await params;
    const interval = req.nextUrl.searchParams.get("interval") || "15m";
    const db = getPool();

    const bucketMs = INTERVAL_MS[interval];
    if (bucketMs === undefined) {
      return NextResponse.json(
        { error: `Invalid interval. Use one of: ${Object.keys(INTERVAL_MS).join(", ")}` },
        { status: 400 }
      );
    }

    const lookbackMs = LOOKBACK_MS[interval] ?? 0;

    let sql: string;
    const queryParams: (string | number)[] = [poolAddress];

    if (lookbackMs > 0) {
      const cutoff = Date.now() - lookbackMs;
      sql = `SELECT timestamp, open, high, low, close, volume
             FROM price_history
             WHERE pool_address = ? AND timestamp >= ?
             ORDER BY timestamp ASC`;
      queryParams.push(cutoff);
    } else {
      sql = `SELECT timestamp, open, high, low, close, volume
             FROM price_history
             WHERE pool_address = ?
             ORDER BY timestamp ASC`;
    }

    const [rows] = await db.query<RowDataPacket[]>(sql, queryParams);

    const rawCandles: RawCandle[] = rows.map((r) => ({
      time: Math.floor(Number(r.timestamp) / 1000),
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume),
    }));

    // Aggregate into the requested candle interval
    const aggregated = aggregateCandles(rawCandles, bucketMs);

    // Return the most recent MAX_CANDLES — chart controls visible range
    const candles = aggregated.slice(-MAX_CANDLES);

    const queryTimeMs = Math.round((performance.now() - start) * 100) / 100;

    return NextResponse.json({
      pool_address: poolAddress,
      interval,
      data_points: candles.length,
      raw_points: rawCandles.length,
      query_time_ms: queryTimeMs,
      candles,
    });
  } catch (e) {
    console.error("GET /api/pool/[poolAddress]/ohlcv error:", e);
    return NextResponse.json(
      { error: "Failed to fetch OHLCV data" },
      { status: 500 }
    );
  }
}
