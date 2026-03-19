import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import type { RowDataPacket } from "mysql2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TableRow extends RowDataPacket {
  table_name: string;
}

interface ColumnRow extends RowDataPacket {
  Field: string;
  Type: string;
  Key: string;
}

interface CountRow extends RowDataPacket {
  c: number;
}

export async function GET() {
  try {
    const db = getPool();
    const database = process.env.TIDB_DATABASE ?? "chainscope";

    // Get all tables
    const [tableRows] = await db.query<TableRow[]>("SHOW TABLES");

    // The column name from SHOW TABLES is dynamic: "Tables_in_<database>"
    const tableKey = Object.keys(tableRows[0] ?? {}).find((k) => k.startsWith("Tables_in")) ?? "";
    const tableNames = tableRows.map((row) => String((row as Record<string, unknown>)[tableKey] ?? ""));

    // Describe each table in parallel
    const descriptions = await Promise.all(
      tableNames.map((name) =>
        db.query<ColumnRow[]>(`DESCRIBE \`${name}\``)
      )
    );

    const tables = tableNames.map((name, i) => ({
      name,
      columns: descriptions[i][0].map((col) => ({
        name: col.Field,
        type: col.Type,
        key: col.Key,
      })),
    }));

    // Get view count
    const [[viewRows]] = await db.query<CountRow[]>(
      "SELECT COUNT(*) AS c FROM information_schema.views WHERE table_schema = ?",
      [database]
    );

    return NextResponse.json({
      database,
      tables,
      table_count: tables.length,
      view_count: viewRows?.c ?? 0,
    });
  } catch (e) {
    console.error("GET /api/schema error:", e);
    return NextResponse.json(
      { database: "", tables: [], table_count: 0, view_count: 0 },
      { status: 500 }
    );
  }
}
