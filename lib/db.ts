import mysql from "mysql2/promise";

let pool: mysql.Pool | null = null;

const getEnv = (key: string, fallback?: string) => {
  const value = (process.env[key] ?? fallback)?.trim();
  if (value === undefined || value === "") {
    throw new Error(`Missing environment variable: ${key}`);
  }
  return value;
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
    password: getEnv("TIDB_PASSWORD", ""),
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
