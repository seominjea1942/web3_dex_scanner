import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import type { RowDataPacket } from "mysql2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CountRow extends RowDataPacket {
  c: number;
}

export async function GET() {
  try {
    const db = getPool();
    const dbName = process.env.TIDB_DATABASE ?? "chainscope";

    const [[txCount], [tableCount], [indexCount], [tokenCount], [poolCount]] = await Promise.all([
      db.query<CountRow[]>("SELECT COUNT(*) as c FROM swap_transactions"),
      db.query<CountRow[]>(
        "SELECT COUNT(*) as c FROM information_schema.tables WHERE table_schema = ?",
        [dbName]
      ),
      db.query<CountRow[]>(
        "SELECT COUNT(*) as c FROM information_schema.statistics WHERE table_schema = ?",
        [dbName]
      ),
      db.query<CountRow[]>("SELECT COUNT(*) as c FROM tokens"),
      db.query<CountRow[]>("SELECT COUNT(*) as c FROM pools"),
    ]);

    const totalRows =
      (txCount[0]?.c ?? 0) +
      (tokenCount[0]?.c ?? 0) +
      (poolCount[0]?.c ?? 0);

    return NextResponse.json({
      dataset_count: txCount[0]?.c ?? 0,
      table_count: tableCount[0]?.c ?? 0,
      index_count: indexCount[0]?.c ?? 0,
      total_rows: totalRows,
    });
  } catch (e) {
    console.error("GET /api/workload-context error:", e);
    return NextResponse.json(
      { dataset_count: 0, table_count: 0, index_count: 0, total_rows: 0 },
      { status: 500 }
    );
  }
}
