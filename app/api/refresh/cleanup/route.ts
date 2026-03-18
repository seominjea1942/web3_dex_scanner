import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && secret !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getPool();

    const [eventsResult] = await db.execute(
      "DELETE FROM defi_events WHERE timestamp < (UNIX_TIMESTAMP() - 7 * 24 * 3600) * 1000"
    );
    const eventsDeleted = (eventsResult as { affectedRows: number }).affectedRows;

    const [metricsResult] = await db.execute(
      "DELETE FROM performance_metrics WHERE recorded_at < NOW() - INTERVAL 7 DAY"
    );
    const metricsDeleted = (metricsResult as { affectedRows: number }).affectedRows;

    return NextResponse.json({
      ok: true,
      eventsDeleted,
      metricsDeleted,
    });
  } catch (e) {
    console.error("POST /api/refresh/cleanup error:", e);
    return NextResponse.json({ error: "Cleanup failed" }, { status: 500 });
  }
}
