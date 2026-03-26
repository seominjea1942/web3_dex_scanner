import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/search/click
 * Track when a user clicks a search result to boost future ranking.
 * Fire-and-forget from the frontend — fast response, async DB update.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const tokenAddress = body.token_address;

    if (!tokenAddress || typeof tokenAddress !== "string") {
      return NextResponse.json({ error: "token_address required" }, { status: 400 });
    }

    // Sanitize: must look like a valid address (alphanumeric, 20-64 chars)
    if (!/^[a-zA-Z0-9]{20,64}$/.test(tokenAddress)) {
      return NextResponse.json({ error: "invalid token_address" }, { status: 400 });
    }

    const db = getPool();

    // Increment search_popularity (capped at 10000 to prevent runaway)
    await db.execute(
      `UPDATE tokens
       SET search_popularity = LEAST(COALESCE(search_popularity, 0) + 1, 10000)
       WHERE address = ?`,
      [tokenAddress]
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[search/click] Error:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
