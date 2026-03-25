import mysql from "mysql2/promise";

let pool: mysql.Pool | null = null;

const getEnv = (key: string, fallback?: string, allowEmpty = false) => {
  const value = (process.env[key] ?? fallback)?.trim();
  if (value === undefined || (!allowEmpty && value === "")) {
    throw new Error(`Missing environment variable: ${key}`);
  }
  return value ?? "";
};

export const getPool = () => {
  if (pool) {
    return pool;
  }

  const sslEnabled =
    (process.env.TIDB_SSL ?? "true").trim().toLowerCase() !== "false";

  pool = mysql.createPool({
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

  return pool;
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
