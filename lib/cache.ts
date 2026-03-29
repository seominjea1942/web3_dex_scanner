// lib/cache.ts — Two-level cache: L1 in-memory (per isolate) + L2 TiDB (shared across all isolates)
//
// L1 hit  → 0ms   (same isolate, in-memory)
// L2 hit  → ~150ms (different isolate, TiDB primary key lookup)
// Miss     → fetch + write both levels

import { connect } from "@tidbcloud/serverless";

const DATABASE_URL = `mysql://${process.env.TIDB_USER}:${process.env.TIDB_PASSWORD}@${process.env.TIDB_HOST}/${process.env.TIDB_DATABASE}`;

let _conn: ReturnType<typeof connect> | null = null;

function getConn() {
  if (!_conn) _conn = connect({ url: DATABASE_URL });
  return _conn;
}

interface L1Entry {
  data: unknown;
  expiresAt: number;
}

class TiDBCache {
  private l1 = new Map<string, L1Entry>();

  async getOrFetch<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttlMs: number
  ): Promise<{ data: T; fromCache: boolean; fetchTime: number }> {
    const now = Date.now();

    // ── L1: in-memory ──────────────────────────────────────
    const l1 = this.l1.get(key);
    if (l1 && l1.expiresAt > now) {
      // Serve immediately, refresh both levels in background
      fetcher()
        .then((fresh) => {
          this.l1.set(key, { data: fresh, expiresAt: now + ttlMs });
          this._writeTiDB(key, fresh, ttlMs);
        })
        .catch(() => {});
      return { data: l1.data as T, fromCache: true, fetchTime: 0 };
    }

    // ── L2: TiDB ───────────────────────────────────────────
    try {
      const rows = (await getConn().execute(
        "SELECT value, expires_at FROM api_cache WHERE cache_key = ? LIMIT 1",
        [key]
      )) as Array<{ value: string; expires_at: number }>;

      if (rows.length > 0 && rows[0].expires_at > now) {
        // Serverless driver auto-parses JSON columns; handle both cases
        const raw = rows[0].value;
        const data = (typeof raw === "string" ? JSON.parse(raw) : raw) as T;
        // Warm L1 so next request from this isolate is free
        this.l1.set(key, { data, expiresAt: rows[0].expires_at });
        // Refresh both levels in background
        fetcher()
          .then((fresh) => {
            this.l1.set(key, { data: fresh, expiresAt: now + ttlMs });
            this._writeTiDB(key, fresh, ttlMs);
          })
          .catch(() => {});
        return { data, fromCache: true, fetchTime: 0 };
      }
    } catch {
      // TiDB cache lookup failed — fall through to fetch
    }

    // ── Cache miss: fetch and populate both levels ─────────
    const start = performance.now();
    const data = await fetcher();
    const fetchTime = performance.now() - start;

    this.l1.set(key, { data, expiresAt: now + ttlMs });
    this._writeTiDB(key, data, ttlMs).catch(() => {});

    return { data, fromCache: false, fetchTime };
  }

  private async _writeTiDB(key: string, data: unknown, ttlMs: number) {
    const expiry = Date.now() + ttlMs;
    await getConn().execute(
      `INSERT INTO api_cache (cache_key, value, expires_at)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
         value      = VALUES(value),
         expires_at = VALUES(expires_at)`,
      [key, JSON.stringify(data), expiry]
    );
  }

  // Retained for API compatibility
  get<T>(_key: string): T | null { return null; }
  set<T>(_key: string, _data: T, _ttlMs: number): void {}
  clear(): void { this.l1.clear(); }
  get size(): number { return this.l1.size; }
}

export const cache = new TiDBCache();
