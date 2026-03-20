import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import type { RowDataPacket } from "mysql2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ poolAddress: string }> }
) {
  const start = performance.now();

  try {
    const { poolAddress } = await params;
    const limit = Math.min(50, Math.max(1, parseInt(
      req.nextUrl.searchParams.get("limit") || "10",
      10
    )));
    const db = getPool();

    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT
        st.trader_wallet                       AS wallet_address,
        SUM(st.usd_value)                      AS volume_usd,
        SUM(CASE WHEN st.side = 'buy'  THEN 1 ELSE 0 END) AS buys,
        SUM(CASE WHEN st.side = 'sell' THEN 1 ELSE 0 END) AS sells,
        MAX(st.timestamp)                      AS last_active_ts,
        wp.label                               AS wallet_label
      FROM swap_transactions st
      LEFT JOIN wallet_profiles wp ON st.trader_wallet = wp.address
      WHERE st.pool_address = ?
      GROUP BY st.trader_wallet, wp.label
      ORDER BY volume_usd DESC
      LIMIT ?`,
      [poolAddress, limit]
    );

    const traders = rows.map((r, idx) => ({
      rank: idx + 1,
      wallet_address: r.wallet_address,
      volume_usd: Number(r.volume_usd),
      buys: Number(r.buys),
      sells: Number(r.sells),
      label: r.wallet_label ?? null,
      last_active: Number(r.last_active_ts),
    }));

    const queryTimeMs = Math.round((performance.now() - start) * 100) / 100;

    return NextResponse.json({
      pool_address: poolAddress,
      query_time_ms: queryTimeMs,
      traders,
    });
  } catch (e) {
    console.error("GET /api/pool/[poolAddress]/top-traders error:", e);
    return NextResponse.json(
      { error: "Failed to fetch top traders" },
      { status: 500 }
    );
  }
}
