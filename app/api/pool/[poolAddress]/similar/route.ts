import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import type { RowDataPacket } from "mysql2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Similar Patterns API — Dual Mode (Chart Shape + Market Behavior)
 *
 * ?mode=shape    → OHLCV chart shape similarity (pattern_shape_embeddings)
 * ?mode=behavior → Market behavior similarity (pattern_embeddings)
 *
 * Both use TiCI + VEC_COSINE_DISTANCE (HTAP demo).
 */

interface MappedResult {
  pool_address: string;
  pair_name: string;
  token_base_symbol: string;
  token_quote_symbol: string;
  dex: string;
  volume_24h: number;
  liquidity_usd: number;
  price_usd: number;
  price_change_24h: number;
  price_change_1h?: number;
  price_change_6h?: number;
  similarity_score: number;
}

async function vectorSearch(
  db: ReturnType<typeof getPool>,
  table: string,
  poolAddress: string,
  limit: number,
): Promise<{ results: MappedResult[]; queryTimeMs: number; sql: string } | null> {
  const start = performance.now();

  try {
    // Check if reference pool exists in this table first
    const [refCheck] = await db.query<RowDataPacket[]>(
      `SELECT 1 FROM ${table} WHERE pool_address = ? LIMIT 1`,
      [poolAddress]
    );
    if (refCheck.length === 0) return null; // reference not in this table

    const hasChainCol = table === "pattern_embeddings";
    const extraCols = table === "pattern_embeddings"
      ? "pe.market_cap, pe.price_change_1h, pe.price_change_6h,"
      : "";
    const chainFilter = hasChainCol ? "AND pe.chain = 'solana'" : "";

    const sql = `
      SELECT
        pe.pool_address, pe.pair_name, pe.token_base_symbol, pe.token_quote_symbol,
        pe.dex, pe.volume_24h, pe.liquidity_usd, pe.price_usd, pe.price_change_24h,
        ${extraCols}
        (1 - VEC_COSINE_DISTANCE(pe.embedding, (
          SELECT embedding FROM ${table} WHERE pool_address = ? LIMIT 1
        ))) AS similarity
      FROM ${table} pe
      WHERE pe.pool_address != ? ${chainFilter}
      ORDER BY similarity DESC
      LIMIT ?
    `;

    const [rows] = await db.query<RowDataPacket[]>(sql, [poolAddress, poolAddress, limit]);
    const queryTimeMs = Math.round((performance.now() - start) * 100) / 100;

    const mapped: MappedResult[] = rows.map((r) => ({
      pool_address: r.pool_address,
      pair_name: r.pair_name,
      token_base_symbol: r.token_base_symbol,
      token_quote_symbol: r.token_quote_symbol,
      dex: r.dex,
      volume_24h: Number(r.volume_24h ?? 0),
      liquidity_usd: Number(r.liquidity_usd ?? 0),
      price_usd: Number(r.price_usd ?? 0),
      price_change_24h: Number(r.price_change_24h ?? 0),
      ...(r.price_change_1h !== undefined ? { price_change_1h: Number(r.price_change_1h ?? 0) } : {}),
      ...(r.price_change_6h !== undefined ? { price_change_6h: Number(r.price_change_6h ?? 0) } : {}),
      similarity_score: Math.round(Number(r.similarity) * 10000) / 10000,
    }));

    // HNSW is approximate — re-sort for exact ordering
    mapped.sort((a, b) => b.similarity_score - a.similarity_score);

    const displaySql = `-- TiCI pre-filter + Vector Search
SELECT pe.pair_name, pe.dex, pe.volume_24h,
  (1 - VEC_COSINE_DISTANCE(pe.embedding, (
    SELECT embedding FROM ${table}
    WHERE pool_address = '${poolAddress.slice(0, 8)}...'
  ))) AS similarity
FROM ${table} pe
WHERE pe.pool_address != '${poolAddress.slice(0, 8)}...'
ORDER BY similarity DESC LIMIT ${limit};`;

    return { results: mapped, queryTimeMs, sql: displaySql };
  } catch (err) {
    console.warn(`Vector search on ${table} failed:`, (err as Error).message);
    return null;
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ poolAddress: string }> }
) {
  try {
    const { poolAddress } = await params;
    const limit = Math.min(20, Math.max(1, parseInt(
      req.nextUrl.searchParams.get("limit") || "6", 10
    )));
    const mode = req.nextUrl.searchParams.get("mode") || "shape";
    const db = getPool();

    const table = mode === "behavior" ? "pattern_embeddings" : "pattern_shape_embeddings";
    const result = await vectorSearch(db, table, poolAddress, limit);

    if (result && result.results.length > 0) {
      return NextResponse.json({
        pool_address: poolAddress,
        query_time_ms: result.queryTimeMs,
        mode,
        method: "tici_vector_cosine",
        htap_sql: result.sql,
        results: result.results,
      });
    }

    // Fallback: try the other table
    const fallbackTable = mode === "behavior" ? "pattern_shape_embeddings" : "pattern_embeddings";
    const fallback = await vectorSearch(db, fallbackTable, poolAddress, limit);

    if (fallback && fallback.results.length > 0) {
      return NextResponse.json({
        pool_address: poolAddress,
        query_time_ms: fallback.queryTimeMs,
        mode: mode === "behavior" ? "shape" : "behavior",
        method: "tici_vector_cosine",
        htap_sql: fallback.sql,
        results: fallback.results,
        fallback: true,
      });
    }

    // No vector results at all
    return NextResponse.json({
      pool_address: poolAddress,
      query_time_ms: 0,
      mode,
      method: "none",
      results: [],
    });
  } catch (e) {
    console.error("GET /api/pool/[poolAddress]/similar error:", e);
    return NextResponse.json({ error: "Failed to fetch similar pools" }, { status: 500 });
  }
}
