import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import type { RowDataPacket } from "mysql2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const db = getPool();
    const params = req.nextUrl.searchParams;

    const sort = params.get("sort") || "volume_24h";
    const order = params.get("order") === "asc" ? "ASC" : "DESC";
    const search = params.get("search") || "";
    const page = Math.max(1, parseInt(params.get("page") || "1"));
    const limit = Math.min(100, Math.max(1, parseInt(params.get("limit") || "20")));
    const minVolume = parseFloat(params.get("min_volume") || "0");
    const maxAge = params.get("max_age"); // "24h" for new pools

    const offset = (page - 1) * limit;

    // Valid sort columns
    const sortMap: Record<string, string> = {
      volume_24h: "p.volume_24h",
      liquidity_usd: "p.liquidity_usd",
      price_change_24h: "p.price_change_24h",
      market_cap: "p.market_cap",
      txns_24h: "p.txns_24h",
      trending: "(p.volume_24h / GREATEST(p.liquidity_usd, 1))",
    };
    const sortCol = sortMap[sort] || "p.volume_24h";

    let where = "WHERE 1=1";
    const queryParams: (string | number)[] = [];

    if (search) {
      where += " AND (p.pair_label LIKE ? OR t_base.symbol LIKE ? OR t_base.name LIKE ? OR p.id LIKE ?)";
      const s = `%${search}%`;
      queryParams.push(s, s, s, s);
    }

    if (minVolume > 0) {
      where += " AND p.volume_24h >= ?";
      queryParams.push(minVolume);
    }

    if (maxAge === "24h") {
      where += " AND p.pool_created_at >= NOW() - INTERVAL 24 HOUR";
    }

    // Count query
    const [countRows] = await db.query<Array<{ total: number } & RowDataPacket>>(
      `SELECT COUNT(*) as total FROM pools p
       LEFT JOIN tokens t_base ON p.token_base_id = t_base.id
       ${where}`,
      queryParams
    );
    const total = countRows[0]?.total ?? 0;

    // Data query
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT p.*,
        t_base.logo_url as base_logo_url,
        t_base.name as base_name,
        t_base.symbol as base_symbol,
        t_quote.logo_url as quote_logo_url,
        t_quote.symbol as quote_symbol
       FROM pools p
       LEFT JOIN tokens t_base ON p.token_base_id = t_base.id
       LEFT JOIN tokens t_quote ON p.token_quote_id = t_quote.id
       ${where}
       ORDER BY ${sortCol} ${order}
       LIMIT ? OFFSET ?`,
      [...queryParams, limit, offset]
    );

    return NextResponse.json({
      pools: rows,
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
