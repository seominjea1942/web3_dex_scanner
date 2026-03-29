// lib/db-edge.ts — Edge-compatible TiDB connection using @tidbcloud/serverless
// Uses HTTP-based driver (no TCP, no Node.js APIs) — works in Vercel Edge Runtime globally.

import { connect } from "@tidbcloud/serverless";

let conn: ReturnType<typeof connect> | null = null;

const DATABASE_URL = `mysql://${process.env.TIDB_USER}:${process.env.TIDB_PASSWORD}@${process.env.TIDB_HOST}/${process.env.TIDB_DATABASE}`;

export function getEdgeConnection() {
  if (!conn) {
    conn = connect({ url: DATABASE_URL });
  }
  return conn;
}
