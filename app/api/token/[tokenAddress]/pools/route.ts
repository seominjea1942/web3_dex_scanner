import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import type { RowDataPacket } from "mysql2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tokenAddress: string }> }
) {
  const start = performance.now();

  try {
    const { tokenAddress } = await params;
    const db = getPool();

    // Fetch all pools where the given token is the base token
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT
        p.address          AS pool_address,
        p.dex,
        CONCAT(p.token_base_symbol, '/', p.token_quote_symbol) AS pair_name,
        p.price_usd,
        p.price_change_24h,
        p.market_cap,
        p.volume_24h,
        p.liquidity_usd
      FROM pools p
      WHERE p.token_base_address = ?
      ORDER BY p.volume_24h DESC`,
      [tokenAddress]
    );

    if (rows.length === 0) {
      // Check if the token exists at all
      const [tokenRows] = await db.query<RowDataPacket[]>(
        `SELECT symbol FROM tokens WHERE address = ?`,
        [tokenAddress]
      );

      if (tokenRows.length === 0) {
        return NextResponse.json(
          { error: "Token not found" },
          { status: 404 }
        );
      }

      // Token exists but has no pools
      const queryTimeMs = Math.round((performance.now() - start) * 100) / 100;
      return NextResponse.json({
        token_address: tokenAddress,
        token_symbol: tokenRows[0].symbol,
        query_time_ms: queryTimeMs,
        pools: [],
      });
    }

    // Compute total volume across all pools for volume_share
    const totalVolume = rows.reduce(
      (sum, r) => sum + Number(r.volume_24h ?? 0),
      0
    );

    // Resolve token symbol from the first pool row
    const tokenSymbol = rows[0].pair_name?.split("/")[0] ?? null;

    const pools = rows.map((r) => {
      const vol = Number(r.volume_24h ?? 0);
      return {
        pool_address: r.pool_address,
        dex: r.dex,
        pair_name: r.pair_name,
        price: Number(r.price_usd),
        price_change_24h: Number(r.price_change_24h ?? 0),
        market_cap: Number(r.market_cap ?? 0),
        volume_24h: vol,
        liquidity: Number(r.liquidity_usd ?? 0),
        volume_share:
          totalVolume > 0
            ? Math.round((vol / totalVolume) * 10000) / 10000
            : 0,
      };
    });

    const queryTimeMs = Math.round((performance.now() - start) * 100) / 100;

    return NextResponse.json({
      token_address: tokenAddress,
      token_symbol: tokenSymbol,
      query_time_ms: queryTimeMs,
      pools,
    });
  } catch (e) {
    console.error("GET /api/token/[tokenAddress]/pools error:", e);
    return NextResponse.json(
      { error: "Failed to fetch token pools" },
      { status: 500 }
    );
  }
}
