import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import type { RowDataPacket } from "mysql2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Map frontend event type filters to v2 schema event_type values
const EVENT_TYPE_MAP: Record<string, string[]> = {
  liquidity: ["liquidity_add", "liquidity_remove"],
  swap: ["large_trade"],
};

export async function GET(req: NextRequest) {
  try {
    const db = getPool();
    const params = req.nextUrl.searchParams;

    const type = params.get("type"); // comma-separated: "whale,new_pool,liquidity,smart_money"
    const limit = Math.min(100, Math.max(1, parseInt(params.get("limit") || "30")));
    const offset = Math.max(0, parseInt(params.get("offset") || "0"));
    const minAmount = parseFloat(params.get("min_amount") || "0");

    let where = "WHERE 1=1";
    const queryParams: (string | number)[] = [];

    if (type) {
      const types = type.split(",").map((t) => t.trim()).filter(Boolean);
      // Expand frontend types to v2 types
      const v2Types: string[] = [];
      for (const t of types) {
        if (EVENT_TYPE_MAP[t]) {
          v2Types.push(...EVENT_TYPE_MAP[t]);
        } else {
          v2Types.push(t);
        }
      }
      if (v2Types.length > 0) {
        where += ` AND event_type IN (${v2Types.map(() => "?").join(",")})`;
        queryParams.push(...v2Types);
      }
    }

    if (minAmount > 0) {
      where += " AND usd_value >= ?";
      queryParams.push(minAmount);
    }

    // v2: alias columns to old names for frontend compatibility
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT *,
        FROM_UNIXTIME(timestamp / 1000) as created_at,
        trader_wallet as wallet_address,
        usd_value as amount_usd,
        dex as dex_name,
        (UNIX_TIMESTAMP() - timestamp / 1000) as seconds_ago,
        pool_address,
        severity
       FROM defi_events ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
      [...queryParams, limit, offset]
    );

    return NextResponse.json({ events: rows });
  } catch (e) {
    console.error("GET /api/events error:", e);
    return NextResponse.json({ error: "Failed to fetch events" }, { status: 500 });
  }
}
