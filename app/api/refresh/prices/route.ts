import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import type { RowDataPacket } from "mysql2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && secret !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getPool();

    // Get top 20 pools by volume
    const [pools] = await db.query<Array<{ id: string; token_base_id: string } & RowDataPacket>>(
      `SELECT address as id, token_base_address as token_base_id FROM pools ORDER BY volume_24h DESC LIMIT 20`
    );

    // Fetch from DexScreener
    const addresses = Array.from(new Set(pools.map((p) => p.token_base_id)));
    let updated = 0;

    for (const addr of addresses.slice(0, 5)) {
      try {
        const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${addr}`);
        if (!res.ok) continue;

        const data = await res.json();
        const pairs = data.pairs ?? [];

        for (const pair of pairs) {
          if (pair.chainId !== "solana") continue;

          await db.execute(
            `UPDATE pools SET
              price_usd = ?,
              price_change_5m = ?,
              price_change_1h = ?,
              price_change_6h = ?,
              price_change_24h = ?,
              volume_1h = ?,
              volume_24h = ?,
              liquidity_usd = ?
             WHERE address = ?`,
            [
              parseFloat(pair.priceUsd || "0"),
              pair.priceChange?.m5 ?? 0,
              pair.priceChange?.h1 ?? 0,
              pair.priceChange?.h6 ?? 0,
              pair.priceChange?.h24 ?? 0,
              pair.volume?.h1 ?? 0,
              pair.volume?.h24 ?? 0,
              pair.liquidity?.usd ?? 0,
              pair.pairAddress,
            ]
          );
          updated++;
        }

        // Rate limit
        await new Promise((r) => setTimeout(r, 1200));
      } catch {
        // Continue on error
      }
    }

    return NextResponse.json({ ok: true, updated });
  } catch (e) {
    console.error("POST /api/refresh/prices error:", e);
    return NextResponse.json({ error: "Failed to refresh prices" }, { status: 500 });
  }
}
