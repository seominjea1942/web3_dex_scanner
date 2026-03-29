import { NextResponse } from "next/server";
import { getEdgeConnection } from "@/lib/db-edge";
import { cache } from "@/lib/cache";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const TRENDING_CACHE_TTL = 15_000; // 15s — trending data refreshes slowly

export async function GET() {
  const start = Date.now();

  try {
    const conn = getEdgeConnection();

    const { data: trending, fromCache } = await cache.getOrFetch(
      "search:trending",
      async () => {
        const [gainers, whaleAlerts, newPools] = await Promise.all([
          conn.execute(
            `SELECT
              p.address, p.token_base_symbol, p.token_quote_symbol,
              p.token_base_address, p.price_usd, p.price_change_24h,
              p.volume_24h, p.dex,
              t.logo_url, t.name AS token_name
            FROM pools p
            LEFT JOIN tokens t ON p.token_base_address = t.address
            WHERE p.volume_24h > 1000
            ORDER BY p.price_change_24h DESC
            LIMIT 5`
          ) as Promise<Record<string, any>[]>,
          conn.execute(
            `SELECT
              de.id, de.event_type, de.severity, de.description,
              de.usd_value, de.pool_address, de.timestamp, de.dex,
              p.token_base_symbol
            FROM defi_events de
            LEFT JOIN pools p ON de.pool_address = p.address
            WHERE de.event_type IN ('whale', 'smart_money')
            ORDER BY de.timestamp DESC
            LIMIT 5`
          ) as Promise<Record<string, any>[]>,
          conn.execute(
            `SELECT
              p.address, p.token_base_symbol, p.token_quote_symbol,
              p.token_base_address, p.price_usd, p.volume_24h,
              p.pool_created_at, p.dex,
              t.logo_url, t.name AS token_name
            FROM pools p
            LEFT JOIN tokens t ON p.token_base_address = t.address
            WHERE p.pool_created_at IS NOT NULL
            ORDER BY p.pool_created_at DESC
            LIMIT 3`
          ) as Promise<Record<string, any>[]>,
        ]);
        return {
          gainers,
          whale_alerts: whaleAlerts,
          new_pools: newPools,
        };
      },
      TRENDING_CACHE_TTL
    );

    const queryTimeMs = Date.now() - start;

    return NextResponse.json({
      ...trending,
      query_time_ms: queryTimeMs,
      fromCache,
    });
  } catch (e) {
    return NextResponse.json(
      { error: "Failed to fetch trending data", detail: String(e) },
      { status: 500 }
    );
  }
}
