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

    // 1. Primary: GeckoTerminal (real data, free, no API key needed)
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

    // 2. Fallback: TiDB cached/seeded data
    const db = getPool();
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT timestamp, open, high, low, close, volume
       FROM price_history
       WHERE pool_address = ?
       ORDER BY timestamp ASC
       LIMIT ?`,
      [poolAddress, MAX_CANDLES]
    );

    const fallbackCandles = rows.map((r) => ({
      time: Math.floor(Number(r.timestamp) / 1000),
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume),
    }));

    return NextResponse.json({
      pool_address: poolAddress,
      interval,
      data_points: fallbackCandles.length,
      source: "tidb_cache",
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
