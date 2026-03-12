import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import type { RowDataPacket } from "mysql2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface MetricRow extends RowDataPacket {
  metric_type: string;
  value: number;
  recorded_at: string;
}

const TIME_RANGE_MAP: Record<string, string> = {
  "1H": "1 HOUR",
  "6H": "6 HOUR",
  "24H": "24 HOUR",
  "7D": "7 DAY",
};

export async function GET(req: NextRequest) {
  try {
    const db = getPool();
    const range = req.nextUrl.searchParams.get("range") || "1H";
    const interval = TIME_RANGE_MAP[range] || "1 HOUR";

    const [rows] = await db.query<MetricRow[]>(
      `SELECT metric_type, value, recorded_at
       FROM performance_metrics
       WHERE recorded_at > NOW() - INTERVAL ${interval}
       ORDER BY recorded_at ASC`
    );

    // Group by metric_type
    const series: Record<string, Array<{ time: string; value: number }>> = {};
    for (const row of rows) {
      if (!series[row.metric_type]) series[row.metric_type] = [];
      series[row.metric_type].push({
        time: row.recorded_at,
        value: Number(row.value),
      });
    }

    return NextResponse.json({ series, range });
  } catch (e) {
    console.error("GET /api/metrics/history error:", e);
    return NextResponse.json({ error: "Failed to fetch metric history" }, { status: 500 });
  }
}
