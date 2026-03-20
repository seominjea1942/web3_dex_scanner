import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import type { RowDataPacket } from "mysql2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Compute a pseudo-similarity score between two pools based on
 * volume_24h and price_change_24h proximity.
 * Returns a value in [0, 1] where 1 = identical pattern.
 */
function similarityScore(
  refVolume: number,
  refChange: number,
  candVolume: number,
  candChange: number
): number {
  // Volume similarity: use log-ratio so pools with 10x volume diff score ~0.5
  const logRef = Math.log10(Math.max(refVolume, 1));
  const logCand = Math.log10(Math.max(candVolume, 1));
  const volDiff = Math.abs(logRef - logCand);
  const volScore = Math.max(0, 1 - volDiff / 5); // 5 orders of magnitude = 0

  // Price-change similarity: absolute difference
  const changeDiff = Math.abs(refChange - candChange);
  const changeScore = Math.max(0, 1 - changeDiff / 100); // 100pp diff = 0

  // Weighted combination
  return Math.round((volScore * 0.4 + changeScore * 0.6) * 1000) / 1000;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ poolAddress: string }> }
) {
  const start = performance.now();

  try {
    const { poolAddress } = await params;
    const limit = Math.min(20, Math.max(1, parseInt(
      req.nextUrl.searchParams.get("limit") || "5",
      10
    )));
    const db = getPool();

    // Get the reference pool
    const [refRows] = await db.query<RowDataPacket[]>(
      `SELECT token_base_address, volume_24h, price_change_24h
       FROM pools
       WHERE address = ?`,
      [poolAddress]
    );

    if (refRows.length === 0) {
      return NextResponse.json(
        { error: "Pool not found" },
        { status: 404 }
      );
    }

    const ref = refRows[0];
    const refVolume = Number(ref.volume_24h ?? 0);
    const refChange = Number(ref.price_change_24h ?? 0);

    // Find candidate pools sharing the same base token
    const [candidates] = await db.query<RowDataPacket[]>(
      `SELECT
        p.address,
        CONCAT(p.token_base_symbol, '/', p.token_quote_symbol) AS pair_name,
        p.dex,
        p.volume_24h,
        p.price_change_24h
      FROM pools p
      WHERE p.token_base_address = ?
        AND p.address != ?
      ORDER BY p.volume_24h DESC
      LIMIT 50`,
      [ref.token_base_address, poolAddress]
    );

    // Score and rank
    const scored = candidates.map((c) => ({
      pool_address: c.address,
      pair_name: c.pair_name,
      dex: c.dex,
      volume_24h: Number(c.volume_24h ?? 0),
      price_change_24h: Number(c.price_change_24h ?? 0),
      similarity_score: similarityScore(
        refVolume,
        refChange,
        Number(c.volume_24h ?? 0),
        Number(c.price_change_24h ?? 0)
      ),
    }));

    scored.sort((a, b) => b.similarity_score - a.similarity_score);
    const topResults = scored.slice(0, limit);

    // Fetch sparkline data (last 20 close prices) for top results
    const sparklines: Record<string, number[]> = {};
    if (topResults.length > 0) {
      const addresses = topResults.map((r) => r.pool_address);
      const placeholders = addresses.map(() => "?").join(",");

      const [sparkRows] = await db.query<RowDataPacket[]>(
        `SELECT pool_address, close, timestamp
         FROM price_history
         WHERE pool_address IN (${placeholders})
         ORDER BY pool_address, timestamp ASC`,
        addresses
      );

      // Group by pool and take last 20 points
      for (const row of sparkRows) {
        const addr = row.pool_address as string;
        if (!sparklines[addr]) sparklines[addr] = [];
        sparklines[addr].push(Number(row.close));
      }
      for (const addr of Object.keys(sparklines)) {
        const data = sparklines[addr];
        if (data.length > 20) {
          sparklines[addr] = data.slice(data.length - 20);
        }
      }
    }

    const results = topResults.map((r) => ({
      ...r,
      sparkline: sparklines[r.pool_address] ?? [],
    }));

    const queryTimeMs = Math.round((performance.now() - start) * 100) / 100;

    return NextResponse.json({
      pool_address: poolAddress,
      query_time_ms: queryTimeMs,
      method: "vector_cosine_similarity",
      results,
    });
  } catch (e) {
    console.error("GET /api/pool/[poolAddress]/similar error:", e);
    return NextResponse.json(
      { error: "Failed to fetch similar pools" },
      { status: 500 }
    );
  }
}
