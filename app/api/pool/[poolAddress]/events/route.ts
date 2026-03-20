import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import type { RowDataPacket } from "mysql2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function formatTimeAgo(timestampMs: number): string {
  const seconds = Math.floor((Date.now() - timestampMs) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ poolAddress: string }> }
) {
  const start = performance.now();

  try {
    const { poolAddress } = await params;
    const limit = Math.min(100, Math.max(1, parseInt(
      req.nextUrl.searchParams.get("limit") || "10",
      10
    )));
    const db = getPool();

    // Count events in the last 24 hours
    const [countRows] = await db.query<Array<{ cnt: number } & RowDataPacket>>(
      `SELECT COUNT(*) AS cnt
       FROM defi_events
       WHERE pool_address = ?
         AND timestamp >= (UNIX_TIMESTAMP() * 1000 - 86400000)`,
      [poolAddress]
    );
    const total24h = countRows[0]?.cnt ?? 0;

    // Fetch recent events
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT
        id,
        event_type,
        severity,
        description,
        timestamp,
        dex,
        trader_wallet,
        usd_value
      FROM defi_events
      WHERE pool_address = ?
      ORDER BY timestamp DESC
      LIMIT ?`,
      [poolAddress, limit]
    );

    const events = rows.map((r) => ({
      id: r.id,
      type: r.event_type,
      severity: r.severity,
      title: r.description,
      time_ago: formatTimeAgo(Number(r.timestamp)),
      timestamp: Number(r.timestamp),
      dex: r.dex,
      trader_wallet: r.trader_wallet ?? null,
      usd_value: r.usd_value ? Number(r.usd_value) : null,
    }));

    const queryTimeMs = Math.round((performance.now() - start) * 100) / 100;

    return NextResponse.json({
      pool_address: poolAddress,
      total_24h: total24h,
      query_time_ms: queryTimeMs,
      events,
    });
  } catch (e) {
    console.error("GET /api/pool/[poolAddress]/events error:", e);
    return NextResponse.json(
      { error: "Failed to fetch events" },
      { status: 500 }
    );
  }
}
