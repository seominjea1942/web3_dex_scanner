import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { replayOneEvent } from "@/lib/event-replay";
import type { RowDataPacket } from "mysql2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const db = getPool();
    const params = req.nextUrl.searchParams;

    // Lazy replay: if last event is older than 3s, generate new ones
    const [ageRows] = await db.query<RowDataPacket[]>(
      `SELECT TIMESTAMPDIFF(SECOND, MAX(created_at), NOW()) as age FROM defi_events`
    );
    const age = (ageRows[0] as Record<string, unknown>)?.age as number | null;
    if (age === null || age > 8) {
      const count = 1 + Math.floor(Math.random() * 2);
      for (let i = 0; i < count; i++) {
        await replayOneEvent();
      }
    }

    const type = params.get("type"); // comma-separated: "whale,new_pool,liquidity,smart_money"
    const limit = Math.min(100, Math.max(1, parseInt(params.get("limit") || "30")));
    const minAmount = parseFloat(params.get("min_amount") || "0");

    let where = "WHERE 1=1";
    const queryParams: (string | number)[] = [];

    if (type) {
      const types = type.split(",").map((t) => t.trim()).filter(Boolean);
      if (types.length > 0) {
        where += ` AND event_type IN (${types.map(() => "?").join(",")})`;
        queryParams.push(...types);
      }
    } else {
      // Default "All" tab: everything except swap
      where += " AND event_type != 'swap'";
    }

    if (minAmount > 0) {
      where += " AND amount_usd >= ?";
      queryParams.push(minAmount);
    }

    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT *, TIMESTAMPDIFF(SECOND, created_at, NOW()) as seconds_ago
       FROM defi_events ${where} ORDER BY created_at DESC LIMIT ?`,
      [...queryParams, limit]
    );

    return NextResponse.json({ events: rows });
  } catch (e) {
    console.error("GET /api/events error:", e);
    return NextResponse.json({ error: "Failed to fetch events" }, { status: 500 });
  }
}
