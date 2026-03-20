import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import type { FieldPacket } from "mysql2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Only allow read-only SQL statements
const ALLOWED_PREFIXES = ["SELECT", "EXPLAIN", "SHOW", "DESCRIBE", "DESC", "WITH"];
const DANGEROUS_KEYWORDS = [
  "INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "TRUNCATE",
  "CREATE", "GRANT", "REVOKE", "SET", "CALL", "LOAD",
  "INTO OUTFILE", "INTO DUMPFILE", "REPLACE",
];

/** Strip SQL comments so validation sees the actual statement keyword */
function stripComments(sql: string): string {
  // Remove block comments  /* ... */
  let s = sql.replace(/\/\*[\s\S]*?\*\//g, "");
  // Remove single-line comments  -- ...
  s = s.replace(/--[^\n]*/g, "");
  return s.trim();
}

function validateSql(sql: string): string | null {
  const trimmed = sql.trim().replace(/;+$/, "").trim();
  if (!trimmed) return "Empty query";

  // Strip comments before checking the first keyword
  const stripped = stripComments(trimmed);
  if (!stripped) return "Empty query (comments only)";

  // Check first keyword
  const firstWord = stripped.split(/\s+/)[0].toUpperCase();
  if (!ALLOWED_PREFIXES.includes(firstWord)) {
    return `Only SELECT, EXPLAIN, SHOW, and DESCRIBE queries are allowed. Got: ${firstWord}`;
  }

  // Check for dangerous keywords (case-insensitive)
  const upper = trimmed.toUpperCase();
  for (const keyword of DANGEROUS_KEYWORDS) {
    // Match as whole word to avoid false positives (e.g., "DESCRIPTION" matching "DESC")
    const regex = new RegExp(`\\b${keyword}\\b`);
    if (regex.test(upper) && !["DESC", "DESCRIBE"].includes(keyword)) {
      return `Query contains disallowed keyword: ${keyword}`;
    }
  }

  // Check for multiple statements
  // Simple check: strip string literals, then check for semicolons
  const noStrings = trimmed.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
  if (noStrings.includes(";")) {
    return "Multiple statements are not allowed";
  }

  return null; // valid
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const sql = (body.sql || "").trim().replace(/;+$/, "").trim();

    // Validate
    const error = validateSql(sql);
    if (error) {
      return NextResponse.json({ error }, { status: 400 });
    }

    const db = getPool();

    // Enforce LIMIT if user didn't provide one (prevent 7M row responses)
    let execSql = sql;
    const strippedUpper = stripComments(sql).toUpperCase();
    if (strippedUpper.startsWith("SELECT") && !strippedUpper.includes("LIMIT")) {
      execSql = `${sql} LIMIT 1000`;
    }

    // Execute with server-side timing
    const startMs = performance.now();
    const [rows, fields] = await db.query(execSql) as [Record<string, unknown>[], FieldPacket[]];
    const executionTimeMs = Math.round((performance.now() - startMs) * 100) / 100;

    // Extract column names from field metadata
    const columns = fields.map((f) => f.name);

    return NextResponse.json({
      columns,
      rows: Array.isArray(rows) ? rows.slice(0, 1000) : [],
      rowCount: Array.isArray(rows) ? rows.length : 0,
      executionTimeMs,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Query execution failed";
    console.error("POST /api/sql/execute error:", message);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
