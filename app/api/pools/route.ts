import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import type { RowDataPacket } from "mysql2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lazy pool sync: trigger /api/sync/pools when data is stale (>5 min)
const lazySyncPools = async (req: NextRequest) => {
  try {
    const origin = req.nextUrl.origin;
    const res = await fetch(`${origin}/api/sync/pools`, {
      method: "GET",
      headers: { "x-internal": "1" },
    });
    if (!res.ok) console.warn("Pool sync returned", res.status);
  } catch (err) {
    console.warn("Pool sync skipped:", err);
  }
};

export async function GET(req: NextRequest) {
  try {
    const db = getPool();
    const params = req.nextUrl.searchParams;

    // Fire-and-forget: sync pools from DexScreener if stale (>5 min)
    // Don't await — let it run in background while we serve cached data
    lazySyncPools(req).catch(() => {});

    const sort = params.get("sort") || "volume_24h";
    const order = params.get("order") === "asc" ? "ASC" : "DESC";
    const search = params.get("search") || "";
    const page = Math.max(1, parseInt(params.get("page") || "1"));
    const limit = Math.min(100, Math.max(1, parseInt(params.get("limit") || "20")));
    const filter = params.get("filter"); // "hot" | "gainers" | "losers"

    const offset = (page - 1) * limit;

    // Valid sort columns (v2 schema)
    const sortMap: Record<string, string> = {
      volume_24h: "p.volume_24h",
      liquidity_usd: "p.liquidity_usd",
      price_change_24h: "p.price_change_24h",
      market_cap: "p.market_cap",
      txns_24h: "(COALESCE(p.txns_24h_buys,0) + COALESCE(p.txns_24h_sells,0))",
      trending: "(p.volume_24h / GREATEST(p.liquidity_usd, 1))",
      newest: "p.pool_created_at",
      velocity: "(COALESCE(p.volume_1h,0) / GREATEST(p.volume_24h / 24, 1))",
    };

    // Filters use the user's chosen sort (from dropdown).
    // Gainers/Losers override sort to price_change since that's always the intent.
    let effectiveSort = sort;
    let effectiveOrder = order;
    if (filter === "gainers") {
      effectiveSort = "price_change_24h";
      effectiveOrder = "DESC";
    } else if (filter === "losers") {
      effectiveSort = "price_change_24h";
      effectiveOrder = "ASC";
    }

    const sortCol = sortMap[effectiveSort] || "p.volume_24h";

    let where = "WHERE 1=1";
    const queryParams: (string | number)[] = [];

    if (search) {
      where += " AND (CONCAT(p.token_base_symbol, '/', p.token_quote_symbol) LIKE ? OR p.token_base_symbol LIKE ? OR t_base.name LIKE ? OR p.address LIKE ?)";
      const s = `%${search}%`;
      queryParams.push(s, s, s, s);
    }

    // Filter conditions
    if (filter === "hot") {
      where += " AND (COALESCE(p.volume_1h,0) / GREATEST(p.volume_24h / 24, 1)) > 1.5";
    } else if (filter === "gainers") {
      where += " AND p.price_change_24h > 0";
    } else if (filter === "losers") {
      where += " AND p.price_change_24h < 0";
    }

    // Run count + data queries in parallel (saves ~180ms RTT)
    const [countResult, dataResult] = await Promise.all([
      db.query<Array<{ total: number } & RowDataPacket>>(
        `SELECT COUNT(*) as total FROM pools p
         LEFT JOIN tokens t_base ON p.token_base_address = t_base.address
         ${where}`,
        queryParams
      ),
      db.query<RowDataPacket[]>(
        `SELECT
          p.address as id,
          p.token_base_address as token_base_id,
          p.token_quote_address as token_quote_id,
          CONCAT(p.token_base_symbol, '/', p.token_quote_symbol) as pair_label,
          p.dex as dex_name,
          'AMM' as pool_type,
          'solana' as chain,
          (COALESCE(p.txns_24h_buys,0) + COALESCE(p.txns_24h_sells,0)) as makers,
          (COALESCE(p.txns_24h_buys,0) + COALESCE(p.txns_24h_sells,0)) as txns_24h,
          p.last_updated as updated_at,
          p.price_usd,
          p.price_change_5m,
          p.price_change_1h,
          p.price_change_6h,
          p.price_change_24h,
          p.volume_24h,
          COALESCE(p.volume_1h, 0) as volume_1h,
          p.liquidity_usd,
          p.market_cap,
          p.pool_created_at,
          t_base.logo_url as base_logo_url,
          t_base.name as base_name,
          t_base.symbol as base_symbol,
          t_quote.logo_url as quote_logo_url,
          t_quote.symbol as quote_symbol
         FROM pools p
         LEFT JOIN tokens t_base ON p.token_base_address = t_base.address
         LEFT JOIN tokens t_quote ON p.token_quote_address = t_quote.address
         ${where}
         ORDER BY ${sortCol} ${effectiveOrder}
         LIMIT ? OFFSET ?`,
        [...queryParams, limit, offset]
      ),
    ]);

    const total = countResult[0][0]?.total ?? 0;
    const rows = dataResult[0];

    // Apply live jitter to simulate real-time ticks
    const pools = rows.map((row) => {
      const price = Number(row.price_usd);
      const priceJitter = price * (Math.random() - 0.5) * 0.002; // +-0.1%
      const vol = Number(row.volume_24h);
      const volJitter = vol * (Math.random() - 0.5) * 0.01; // +-0.5%
      const liq = Number(row.liquidity_usd);
      const liqJitter = liq * (Math.random() - 0.5) * 0.004; // +-0.2%
      const mcap = Number(row.market_cap);
      const mcapJitter = mcap * (Math.random() - 0.5) * 0.002; // +-0.1%
      const makers = Number(row.makers);
      const makersJitter = Math.round((Math.random() - 0.5) * Math.max(4, makers * 0.002));
      return {
        ...row,
        price_usd: (price + priceJitter).toFixed(price < 1 ? 6 : 2),
        price_change_5m: (Number(row.price_change_5m) + (Math.random() - 0.5) * 0.08).toFixed(2),
        price_change_1h: (Number(row.price_change_1h) + (Math.random() - 0.5) * 0.06).toFixed(2),
        price_change_6h: (Number(row.price_change_6h) + (Math.random() - 0.5) * 0.04).toFixed(2),
        price_change_24h: (Number(row.price_change_24h) + (Math.random() - 0.5) * 0.02).toFixed(2),
        volume_24h: (vol + volJitter).toFixed(2),
        liquidity_usd: (liq + liqJitter).toFixed(2),
        market_cap: (mcap + mcapJitter).toFixed(2),
        makers: makers + makersJitter,
        txns_24h: (Number(row.txns_24h) + makersJitter),
      };
    });

    return NextResponse.json({
      pools,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (e) {
    console.error("GET /api/pools error:", e);
    return NextResponse.json({ error: "Failed to fetch pools" }, { status: 500 });
  }
}
