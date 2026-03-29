import { NextRequest, NextResponse } from "next/server";
import { getEdgeConnection } from "@/lib/db-edge";
import { cache } from "@/lib/cache";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const POOL_DETAIL_CACHE_TTL = 5_000; // 5s — refreshed every 5s by polling

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ poolAddress: string }> }
) {
  const start = Date.now();

  try {
    const { poolAddress } = await params;
    const conn = getEdgeConnection();

    const dbStart = Date.now();
    const { data: queryResult, fromCache } = await cache.getOrFetch(
      `pool-detail:${poolAddress}`,
      async () => {
        // Run both queries in parallel
        const [rows, eventRows] = await Promise.all([
          conn.execute(
            `SELECT
              p.address AS pool_address,
              p.dex,
              p.price_usd,
              p.price_change_1h,
              p.price_change_6h,
              p.price_change_24h,
              p.market_cap,
              p.volume_24h,
              p.liquidity_usd,
              p.pool_created_at,
              p.last_updated,
              p.token_base_address,
              p.token_base_symbol,
              p.token_quote_address,
              p.token_quote_symbol,
              p.volume_5m,
              p.volume_1h,
              p.volume_6h,
              p.txns_5m_buys,
              p.txns_5m_sells,
              p.txns_1h_buys,
              p.txns_1h_sells,
              p.txns_24h_buys,
              p.txns_24h_sells,
              t_base.name   AS base_name,
              t_base.logo_url AS base_logo_url,
              t_quote.name  AS quote_name,
              t_quote.logo_url AS quote_logo_url,
              ts.holder_count
            FROM pools p
            LEFT JOIN tokens t_base  ON p.token_base_address  = t_base.address
            LEFT JOIN tokens t_quote ON p.token_quote_address = t_quote.address
            LEFT JOIN token_safety ts ON p.token_base_address  = ts.token_address
            WHERE p.address = ?`,
            [poolAddress]
          ) as Promise<Record<string, any>[]>,
          conn.execute(
            `SELECT COUNT(*) AS cnt
             FROM defi_events
             WHERE pool_address = ?
               AND timestamp >= (UNIX_TIMESTAMP() * 1000 - 86400000)`,
            [poolAddress]
          ) as Promise<Array<{ cnt: number }>>,
        ]);
        return { rows, eventRows };
      },
      POOL_DETAIL_CACHE_TTL
    );

    const rows = queryResult.rows;
    const eventRows = queryResult.eventRows;

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Pool not found" },
        { status: 404 }
      );
    }

    const pool = rows[0];
    const events24h = eventRows[0]?.cnt ?? 0;
    const queryTimeMs = Date.now() - start;

    const dbTimeMs = fromCache ? 0 : Date.now() - dbStart;
    const headers = new Headers({
      "Cache-Control": "public, s-maxage=5, stale-while-revalidate=30",
      "Server-Timing": `db;dur=${dbTimeMs}, total;dur=${queryTimeMs}`,
    });

    return NextResponse.json({
      pool_address: pool.pool_address,
      dex: pool.dex,
      base_token: {
        symbol: pool.token_base_symbol,
        name: pool.base_name ?? pool.token_base_symbol,
        address: pool.token_base_address,
        icon_url: pool.base_logo_url ?? null,
      },
      quote_token: {
        symbol: pool.token_quote_symbol,
        name: pool.quote_name ?? pool.token_quote_symbol,
        address: pool.token_quote_address,
        icon_url: pool.quote_logo_url ?? null,
      },
      pair_name: `${pool.token_base_symbol}/${pool.token_quote_symbol}`,
      current_price: Number(pool.price_usd),
      price_changes: {
        "1h": Number(pool.price_change_1h),
        "6h": Number(pool.price_change_6h),
        "24h": Number(pool.price_change_24h),
      },
      market_cap: Number(pool.market_cap),
      volume_24h: Number(pool.volume_24h),
      liquidity: Number(pool.liquidity_usd),
      holders: pool.holder_count ? Number(pool.holder_count) : null,
      events_24h: events24h,
      volumes: {
        "5m": Number(pool.volume_5m ?? 0),
        "1h": Number(pool.volume_1h ?? 0),
        "6h": Number(pool.volume_6h ?? 0),
        "24h": Number(pool.volume_24h ?? 0),
      },
      txns: {
        "5m": { buys: Number(pool.txns_5m_buys ?? 0), sells: Number(pool.txns_5m_sells ?? 0) },
        "1h": { buys: Number(pool.txns_1h_buys ?? 0), sells: Number(pool.txns_1h_sells ?? 0) },
        "24h": { buys: Number(pool.txns_24h_buys ?? 0), sells: Number(pool.txns_24h_sells ?? 0) },
      },
      pool_created_at: pool.pool_created_at,
      last_updated: pool.last_updated,
      query_time_ms: queryTimeMs,
      fromCache,
    }, { headers });
  } catch (e) {
    console.error("GET /api/pool/[poolAddress] error:", e);
    return NextResponse.json(
      { error: "Failed to fetch pool detail" },
      { status: 500 }
    );
  }
}
