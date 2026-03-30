import mysql from "mysql2/promise";

// Use globalThis to survive Next.js dev hot-reload without leaking connections
const globalForDb = globalThis as unknown as { __tidb_pool?: mysql.Pool };

const getEnv = (key: string, fallback?: string, allowEmpty = false) => {
  const value = (process.env[key] ?? fallback)?.trim();
  if (value === undefined || (!allowEmpty && value === "")) {
    throw new Error(`Missing environment variable: ${key}`);
  }
  return value ?? "";
};

export const getPool = () => {
  if (globalForDb.__tidb_pool) {
    return globalForDb.__tidb_pool;
  }

  const sslEnabled =
    (process.env.TIDB_SSL ?? "true").trim().toLowerCase() !== "false";

  globalForDb.__tidb_pool = mysql.createPool({
    host: getEnv("TIDB_HOST"),
    port: Number(getEnv("TIDB_PORT", "4000")),
    user: getEnv("TIDB_USER"),
    password: getEnv("TIDB_PASSWORD", "", true),
    database: getEnv("TIDB_DATABASE"),
    waitForConnections: true,
    connectionLimit: 10,
    enableKeepAlive: true,
    ssl: sslEnabled
      ? { minVersion: "TLSv1.2", rejectUnauthorized: true }
      : undefined,
  });

  return globalForDb.__tidb_pool;
};

/**
 * Run a callback with a dedicated connection using TiKV-only reads.
 * Use this for non-vector queries to avoid TiFlash sync issues.
 */
export async function withTiKV<T>(
  fn: (conn: mysql.PoolConnection) => Promise<T>
): Promise<T> {
  const conn = await getPool().getConnection();
  try {
    await conn.query("SET SESSION tidb_isolation_read_engines = 'tikv'");
    return await fn(conn);
  } finally {
    // Reset to default so this pooled connection doesn't break FTS/Vector queries
    await conn.query("SET SESSION tidb_isolation_read_engines = 'tikv,tiflash'").catch(() => {});
    conn.release();
  }
}

/**
 * Run a callback with a dedicated connection using TiFlash-only reads.
 * Use this for analytics / columnar scans (aggregations, full-table filters).
 */
export async function withTiFlash<T>(
  fn: (conn: mysql.PoolConnection) => Promise<T>
): Promise<T> {
  const conn = await getPool().getConnection();
  try {
    await conn.query("SET SESSION tidb_isolation_read_engines = 'tiflash'");
    return await fn(conn);
  } finally {
    await conn.query("SET SESSION tidb_isolation_read_engines = 'tikv,tiflash'").catch(() => {});
    conn.release();
  }
}
