import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { replayOneEvent } from "@/lib/event-replay";

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

    // Generate metrics
    const wt = 25000 + Math.sin(Date.now() * 0.001) * 3000 + (Math.random() - 0.5) * 4000;
    const spike = Math.random() > 0.95 ? Math.random() * 5 : 0;
    const ql = 3.5 + Math.sin(Date.now() * 0.0005) * 0.8 + (Math.random() - 0.5) * 1 + spike;
    const qps = 13000 + Math.sin(Date.now() * 0.0008) * 2000 + (Math.random() - 0.5) * 2000;
    const conn = 2000 + Math.sin(Date.now() * 0.0006) * 300 + (Math.random() - 0.5) * 400;

    await db.execute(
      `INSERT INTO performance_metrics (metric_type, value, recorded_at) VALUES
       ('write_throughput', ?, NOW()), ('query_latency', ?, NOW()), ('qps', ?, NOW()), ('active_connections', ?, NOW())`,
      [Math.round(wt), Math.round(ql * 100) / 100, Math.round(qps), Math.round(conn)]
    );

    // Replay 1-3 events
    const eventCount = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < eventCount; i++) {
      await replayOneEvent();
    }

    return NextResponse.json({ ok: true, events: eventCount });
  } catch (e) {
    console.error("POST /api/refresh/metrics error:", e);
    return NextResponse.json({ error: "Failed to refresh" }, { status: 500 });
  }
}
