import { NextRequest, NextResponse } from "next/server";
import { getEdgeConnection } from "@/lib/db-edge";
import { cache } from "@/lib/cache";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const PRESET_CACHE_TTL = 30_000; // 30s — preset results shared across isolates

// Only allow read-only SQL statements
const ALLOWED_PREFIXES = ["SELECT", "EXPLAIN", "SHOW", "DESCRIBE", "DESC", "WITH"];
const DANGEROUS_KEYWORDS = [
  "INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "TRUNCATE",
  "CREATE", "GRANT", "REVOKE", "SET", "CALL", "LOAD",
  "INTO OUTFILE", "INTO DUMPFILE", "REPLACE",
];

/** Strip SQL comments so validation sees the actual statement keyword */
function stripComments(sql: string): string {
  let s = sql.replace(/\/\*[\s\S]*?\*\//g, "");
  s = s.replace(/--[^\n]*/g, "");
  return s.trim();
}

function validateSql(sql: string): string | null {
  const trimmed = sql.trim().replace(/;+$/, "").trim();
  if (!trimmed) return "Empty query";

  const stripped = stripComments(trimmed);
  if (!stripped) return "Empty query (comments only)";

  const firstWord = stripped.split(/\s+/)[0].toUpperCase();
  if (!ALLOWED_PREFIXES.includes(firstWord)) {
    return `Only SELECT, EXPLAIN, SHOW, and DESCRIBE queries are allowed. Got: ${firstWord}`;
  }

  const upper = trimmed.toUpperCase();
  for (const keyword of DANGEROUS_KEYWORDS) {
    const regex = new RegExp(`\\b${keyword}\\b`);
    if (regex.test(upper) && !["DESC", "DESCRIBE"].includes(keyword)) {
      return `Query contains disallowed keyword: ${keyword}`;
    }
  }

  const noStrings = trimmed.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
  if (noStrings.includes(";")) {
    return "Multiple statements are not allowed";
  }

  return null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const sql = (body.sql || "").trim().replace(/;+$/, "").trim();
    const presetId: string | null = body.presetId ?? null;

    const error = validateSql(sql);
    if (error) {
      return NextResponse.json({ error }, { status: 400 });
    }

    // Enforce LIMIT if user didn't provide one
    let execSql = sql;
    const strippedUpper = stripComments(sql).toUpperCase();
    if (strippedUpper.startsWith("SELECT") && !strippedUpper.includes("LIMIT")) {
      execSql = `${sql} LIMIT 1000`;
    }

    // Cache preset queries — same SQL every time, safe to share
    if (presetId) {
      const { data: cached, fromCache } = await cache.getOrFetch(
        `sql-console:${presetId}`,
        () => runQuery(execSql),
        PRESET_CACHE_TTL
      );
      return NextResponse.json({ ...cached, fromCache });
    }

    const result = await runQuery(execSql);
    return NextResponse.json({ ...result, fromCache: false });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Query execution failed";
    console.error("POST /api/sql/execute error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function runQuery(sql: string) {
  const conn = getEdgeConnection();
  const startMs = performance.now();
  const rows = await conn.execute(sql) as Record<string, unknown>[];
  const totalMs = Math.round((performance.now() - startMs) * 100) / 100;

  // Ask TiDB for the actual server-side processing time of the last query
  let dbExecMs: number | null = null;
  try {
    const info = await conn.execute(
      "SELECT JSON_EXTRACT(tidb_last_query_info(), '$.process_time') AS t"
    ) as Array<{ t: number | string | null }>;
    const raw = info?.[0]?.t;
    if (raw !== null && raw !== undefined) {
      dbExecMs = Math.round(Number(raw) * 1000);
    }
  } catch {
    // tidb_last_query_info() not available — fall back to total time
  }

  const rowsArr = Array.isArray(rows) ? rows : [];
  const columns = rowsArr.length > 0 ? Object.keys(rowsArr[0]) : [];
  return {
    columns,
    rows: rowsArr.slice(0, 1000),
    rowCount: rowsArr.length,
    executionTimeMs: dbExecMs ?? totalMs,
  };
}
