import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import type { RowDataPacket } from "mysql2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RANGE_MS: Record<string, number> = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 0, // 0 means no filter — return all data
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ poolAddress: string }> }
) {
  const start = performance.now();

  try {
    const { poolAddress } = await params;
    const range = req.nextUrl.searchParams.get("range") || "1d";
    const db = getPool();

    const rangeMs = RANGE_MS[range];
    if (rangeMs === undefined) {
      return NextResponse.json(
        { error: `Invalid range. Use one of: ${Object.keys(RANGE_MS).join(", ")}` },
        { status: 400 }
      );
    }

    let sql: string;
    const queryParams: (string | number)[] = [poolAddress];

    if (rangeMs > 0) {
      const cutoff = Date.now() - rangeMs;
      sql = `SELECT timestamp, open, high, low, close, volume
             FROM price_history
             WHERE pool_address = ? AND timestamp >= ?
             ORDER BY timestamp ASC`;
      queryParams.push(cutoff);
    } else {
      // 30d — all data
      sql = `SELECT timestamp, open, high, low, close, volume
             FROM price_history
             WHERE pool_address = ?
             ORDER BY timestamp ASC`;
    }

    const [rows] = await db.query<RowDataPacket[]>(sql, queryParams);

    const candles = rows.map((r) => ({
      time: Math.floor(Number(r.timestamp) / 1000), // convert ms to unix seconds
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume),
    }));

    const queryTimeMs = Math.round((performance.now() - start) * 100) / 100;

    return NextResponse.json({
      pool_address: poolAddress,
      range,
      data_points: candles.length,
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
