import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { generateSpikeMetrics } from "@/lib/spike-generator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Verify cron secret
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && secret !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getPool();

    // Generate spike-aware metrics
    const m = generateSpikeMetrics();

    await db.execute(
      `INSERT INTO performance_metrics (metric_type, value, recorded_at) VALUES
       ('write_throughput', ?, NOW()), ('query_latency', ?, NOW()), ('qps', ?, NOW()), ('active_connections', ?, NOW())`,
      [m.wt, m.ql, m.qps, m.conn]
    );

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("POST /api/refresh/metrics error:", e);
    return NextResponse.json({ error: "Failed to refresh" }, { status: 500 });
  }
}
