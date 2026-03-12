import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import type { RowDataPacket } from "mysql2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface MetricRow extends RowDataPacket {
  metric_type: string;
  value: number;
  recorded_at: string;
}

export async function GET() {
  try {
    const db = getPool();

    // Lazy refresh: if last metric is older than 5s, generate new ones
    const [lastRows] = await db.query<MetricRow[]>(
      `SELECT TIMESTAMPDIFF(SECOND, MAX(recorded_at), NOW()) as age FROM performance_metrics`
    );

    const age = (lastRows[0] as Record<string, unknown>)?.age as number | null;
    if (age === null || age > 12) {
      await generateMetrics(db);
    }

    // Get latest metrics (one per type)
    const [rows] = await db.query<MetricRow[]>(
      `SELECT m.metric_type, m.value, m.recorded_at
       FROM performance_metrics m
       INNER JOIN (
         SELECT metric_type, MAX(recorded_at) as max_time
         FROM performance_metrics
         GROUP BY metric_type
       ) latest ON m.metric_type = latest.metric_type AND m.recorded_at = latest.max_time`
    );

    // Get sparkline data (last 30 data points per type)
    const [sparkRows] = await db.query<MetricRow[]>(
      `SELECT metric_type, value, recorded_at
       FROM performance_metrics
       WHERE recorded_at > NOW() - INTERVAL 5 MINUTE
       ORDER BY recorded_at ASC`
    );

    const metrics: Record<string, number> = {};
    for (const row of rows) {
      metrics[row.metric_type] = Number(row.value);
    }

    const sparklines: Record<string, number[]> = {};
    for (const row of sparkRows) {
      if (!sparklines[row.metric_type]) sparklines[row.metric_type] = [];
      sparklines[row.metric_type].push(Number(row.value));
    }

    return NextResponse.json({ metrics, sparklines });
  } catch (e) {
    console.error("GET /api/metrics error:", e);
    return NextResponse.json({ error: "Failed to fetch metrics" }, { status: 500 });
  }
}

async function generateMetrics(db: ReturnType<typeof getPool>) {
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
}
