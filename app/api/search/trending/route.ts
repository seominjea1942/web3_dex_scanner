import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import type { RowDataPacket } from "mysql2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const db = getPool();
  const start = performance.now();

  try {
    const [gainersResult, whaleResult, newPoolsResult] = await Promise.all([
      // Top gainers: biggest 24h price increase with meaningful volume
      db.query<RowDataPacket[]>(
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
      ),
      // Recent whale/smart money alerts
      db.query<RowDataPacket[]>(
        `SELECT
          de.id, de.event_type, de.severity, de.description,
          de.usd_value, de.pool_address, de.timestamp, de.dex,
          p.token_base_symbol
        FROM defi_events de
        LEFT JOIN pools p ON de.pool_address = p.address
        WHERE de.event_type IN ('whale', 'smart_money')
        ORDER BY de.timestamp DESC
        LIMIT 5`
      ),
      // Newest pools
      db.query<RowDataPacket[]>(
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
      ),
    ]);

    const queryTimeMs = Math.round(performance.now() - start);

    return NextResponse.json({
      gainers: gainersResult[0],
      whale_alerts: whaleResult[0],
      new_pools: newPoolsResult[0],
      query_time_ms: queryTimeMs,
    });
  } catch (e) {
    return NextResponse.json(
      { error: "Failed to fetch trending data", detail: String(e) },
      { status: 500 }
    );
  }
}
