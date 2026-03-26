// lib/cache.ts — In-memory cache with SWR (stale-while-revalidate) support

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

class InMemoryCache {
  private store = new Map<string, CacheEntry<any>>();

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.store.delete(key);
      return null;
    }
    return entry.data as T;
  }

  set<T>(key: string, data: T, ttlMs: number): void {
    this.store.set(key, {
      data,
      timestamp: Date.now(),
      ttl: ttlMs,
    });
  }

  /**
   * SWR pattern: return cached data immediately + background refresh.
   * On cache miss, fetch and cache before returning.
   */
  async getOrFetch<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttlMs: number
  ): Promise<{ data: T; fromCache: boolean; fetchTime: number }> {
    const cached = this.get<T>(key);
    if (cached !== null) {
      // Background refresh (fire & forget)
      fetcher()
        .then((fresh) => this.set(key, fresh, ttlMs))
        .catch(() => {});
      return { data: cached, fromCache: true, fetchTime: 0 };
    }
    const start = performance.now();
    const data = await fetcher();
    const fetchTime = performance.now() - start;
    this.set(key, data, ttlMs);
    return { data, fromCache: false, fetchTime };
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

export const cache = new InMemoryCache();
