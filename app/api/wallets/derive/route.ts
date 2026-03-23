import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import type { RowDataPacket } from "mysql2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Derive wallet profiles from swap transaction patterns.
 * Run periodically (every 6h) or on-demand.
 *
 * This single SQL query replaces what traditionally requires
 * Kafka → Flink → ClickHouse → Redis — TiDB does it in one shot.
 */
export async function POST(req: NextRequest) {
  // Optional auth
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && secret !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getPool();
  const start = Date.now();

  try {
    // Derive labels from real trading behavior
    await db.query(`
      INSERT INTO wallet_profiles
        (address, label, trade_count, buy_count, sell_count, total_volume, pools_traded, avg_trade_size, first_seen, last_seen)
      SELECT
        trader_wallet AS address,
        CASE
          -- Whale: >$50K total volume
          WHEN SUM(usd_value) > 50000 THEN 'whale'
          -- Bot: >100 trades AND avg trade <$100 (high frequency, small size)
          WHEN COUNT(*) > 100 AND AVG(usd_value) < 100 THEN 'bot'
          -- Smart money: trades across >5 pools with avg >$500
          WHEN COUNT(DISTINCT pool_address) > 5 AND AVG(usd_value) > 500 THEN 'smart_money'
          -- Active trader: >20 trades
          WHEN COUNT(*) > 20 THEN 'active_trader'
          ELSE 'retail'
        END AS label,
        COUNT(*) AS trade_count,
        SUM(CASE WHEN side = 'buy' THEN 1 ELSE 0 END) AS buy_count,
        SUM(CASE WHEN side = 'sell' THEN 1 ELSE 0 END) AS sell_count,
        ROUND(SUM(usd_value), 2) AS total_volume,
        COUNT(DISTINCT pool_address) AS pools_traded,
        ROUND(AVG(usd_value), 2) AS avg_trade_size,
        MIN(timestamp) AS first_seen,
        MAX(timestamp) AS last_seen
      FROM swap_transactions
      WHERE trader_wallet IS NOT NULL AND trader_wallet != ''
      GROUP BY trader_wallet
      HAVING COUNT(*) >= 3
      ON DUPLICATE KEY UPDATE
        label = VALUES(label),
        trade_count = VALUES(trade_count),
        buy_count = VALUES(buy_count),
        sell_count = VALUES(sell_count),
        total_volume = VALUES(total_volume),
        pools_traded = VALUES(pools_traded),
        avg_trade_size = VALUES(avg_trade_size),
        first_seen = VALUES(first_seen),
        last_seen = VALUES(last_seen)
    `);

    // Get summary stats
    const [stats] = await db.query<RowDataPacket[]>(
      `SELECT label, COUNT(*) as count, ROUND(SUM(total_volume), 2) as volume
       FROM wallet_profiles
       GROUP BY label
       ORDER BY volume DESC`
    );

    const [totalRow] = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM wallet_profiles`
    );

    const duration = Date.now() - start;

    return NextResponse.json({
      derived: true,
      duration_ms: duration,
      total_wallets: totalRow[0]?.total ?? 0,
      stats,
    });
  } catch (e) {
    console.error("POST /api/wallets/derive error:", e);
    return NextResponse.json(
      { error: "Wallet derivation failed", details: String(e) },
      { status: 500 }
    );
  }
}
