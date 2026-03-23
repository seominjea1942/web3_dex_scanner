import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import type { RowDataPacket } from "mysql2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() || "";
  if (q.length < 2) return NextResponse.json({ results: [], search_engine: "none" });

  const db = getPool();

  // Try TiCI full-text search first, fall back to LIKE
  try {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT
        p.address,
        p.token_base_symbol,
        p.token_quote_symbol,
        p.token_base_address,
        p.price_usd,
        p.volume_24h,
        p.price_change_24h,
        p.dex,
        t.logo_url,
        t.name AS token_name,
        MATCH(p.token_base_symbol, p.token_base_address)
          AGAINST(? IN NATURAL LANGUAGE MODE) AS relevance
       FROM pools p
       LEFT JOIN tokens t ON p.token_base_address = t.address
       WHERE MATCH(p.token_base_symbol, p.token_base_address)
         AGAINST(? IN NATURAL LANGUAGE MODE)
       ORDER BY relevance DESC
       LIMIT 10`,
      [q, q]
    );

    return NextResponse.json({ results: rows, search_engine: "tici" });
  } catch {
    // Fallback to LIKE if TiCI full-text index doesn't exist
    const like = `%${q}%`;
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT
        p.address,
        p.token_base_symbol,
        p.token_quote_symbol,
        p.token_base_address,
        p.price_usd,
        p.volume_24h,
        p.price_change_24h,
        p.dex,
        t.logo_url,
        t.name AS token_name
       FROM pools p
       LEFT JOIN tokens t ON p.token_base_address = t.address
       WHERE p.token_base_symbol LIKE ?
          OR t.name LIKE ?
          OR p.token_base_address LIKE ?
          OR p.address LIKE ?
       ORDER BY p.volume_24h DESC
       LIMIT 10`,
      [like, like, like, like]
    );

    return NextResponse.json({ results: rows, search_engine: "like_fallback" });
  }
}
