import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import type { RowDataPacket, Pool as MysqlPool } from "mysql2/promise";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── Lazy transaction generation ────────────────────────────────────
// When the newest transaction for a pool is older than STALE_SEC,
// clone recent transactions with fresh timestamps so the demo stays live.
const TX_STALE_SEC = 60;
const TX_REPLAY_BATCH = 5;

const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const randomBase58 = (len: number) => {
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
};

const lazyGenerateTransactions = async (db: MysqlPool, poolAddress: string) => {
  const [ageRows] = await db.query<RowDataPacket[]>(
    `SELECT (UNIX_TIMESTAMP() - MAX(timestamp) / 1000) as age
     FROM swap_transactions WHERE pool_address = ?`,
    [poolAddress]
  );
  const age = Number((ageRows[0] as Record<string, unknown>)?.age ?? 0);
  if (age < TX_STALE_SEC) return;

  // Sample recent transactions from this pool as templates
  const [templates] = await db.query<RowDataPacket[]>(
    `SELECT side, dex, base_amount, quote_amount, usd_value
     FROM swap_transactions WHERE pool_address = ? ORDER BY timestamp DESC LIMIT 50`,
    [poolAddress]
  );
  if (templates.length === 0) return;

  const nowMs = Date.now();
  const placeholders: string[] = [];
  const values: (string | number)[] = [];

  for (let i = 0; i < TX_REPLAY_BATCH; i++) {
    const tmpl = templates[Math.floor(Math.random() * templates.length)];
    const wallet = randomBase58(44);
    const sig = randomBase58(88);
    const amountMult = 0.3 + Math.random() * 1.7;
    const ts = nowMs - i * (3000 + Math.floor(Math.random() * 12000));
    const side = Math.random() > 0.5 ? "buy" : "sell";

    placeholders.push("(?, ?, ?, ?, ?, ?, ?, ?, ?)");
    values.push(
      sig,
      ts,
      poolAddress,
      tmpl.dex || "raydium",
      side,
      Math.round(Number(tmpl.base_amount) * amountMult * 100) / 100,
      Math.round(Number(tmpl.quote_amount) * amountMult * 100) / 100,
      Math.round(Number(tmpl.usd_value) * amountMult * 100) / 100,
      wallet
    );
  }

  await db.execute(
    `INSERT IGNORE INTO swap_transactions
     (signature, timestamp, pool_address, dex, side, base_amount, quote_amount, usd_value, trader_wallet)
     VALUES ${placeholders.join(", ")}`,
    values
  );
};

const TIME_RANGE_MS: Record<string, number> = {
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ poolAddress: string }> }
) {
  const start = performance.now();

  try {
    const { poolAddress } = await params;
    const sp = req.nextUrl.searchParams;
    const db = getPool();

    // Lazy-generate fresh transactions so the demo stays live
    try {
      await lazyGenerateTransactions(db, poolAddress);
    } catch (genErr) {
      console.warn("Transaction generation skipped:", genErr);
    }

    const direction = sp.get("direction") || "all"; // all | buy | sell
    const walletType = sp.get("wallet_type") || ""; // comma-sep labels
    const minAmount = parseFloat(sp.get("min_amount") || "0");
    const dexFilter = sp.get("dex") || "";
    const timeRange = sp.get("time_range") || ""; // 5m|15m|1h|6h|24h
    const page = Math.max(1, parseInt(sp.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(sp.get("limit") || "50", 10)));
    const offset = (page - 1) * limit;

    // Build WHERE clause
    let where = "WHERE st.pool_address = ?";
    const queryParams: (string | number)[] = [poolAddress];

    // Direction filter
    if (direction === "buy" || direction === "sell") {
      where += " AND st.side = ?";
      queryParams.push(direction);
    }

    // Minimum USD amount
    if (minAmount > 0) {
      where += " AND st.usd_value >= ?";
      queryParams.push(minAmount);
    }

    // DEX filter
    if (dexFilter) {
      where += " AND st.dex = ?";
      queryParams.push(dexFilter);
    }

    // Time range filter
    if (timeRange && TIME_RANGE_MS[timeRange]) {
      const cutoff = Date.now() - TIME_RANGE_MS[timeRange];
      where += " AND st.timestamp >= ?";
      queryParams.push(cutoff);
    }

    // Wallet type filter via join
    const walletTypes = walletType
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    let joinWallet = "LEFT JOIN wallet_profiles wp ON st.trader_wallet = wp.address";
    if (walletTypes.length > 0) {
      joinWallet = "INNER JOIN wallet_profiles wp ON st.trader_wallet = wp.address";
      where += ` AND wp.label IN (${walletTypes.map(() => "?").join(",")})`;
      queryParams.push(...walletTypes);
    }

    // Count total matching rows
    const countSql = `SELECT COUNT(*) AS total
                      FROM swap_transactions st
                      ${joinWallet}
                      ${where}`;
    const [countRows] = await db.query<Array<{ total: number } & RowDataPacket>>(
      countSql,
      queryParams
    );
    const total = countRows[0]?.total ?? 0;

    // Fetch paginated data
    const dataSql = `SELECT
        st.id,
        st.signature,
        st.timestamp,
        st.side,
        st.base_amount,
        st.quote_amount,
        st.usd_value,
        st.trader_wallet,
        st.dex,
        wp.label AS wallet_label
      FROM swap_transactions st
      ${joinWallet}
      ${where}
      ORDER BY st.timestamp DESC
      LIMIT ? OFFSET ?`;

    const [rows] = await db.query<RowDataPacket[]>(dataSql, [
      ...queryParams,
      limit,
      offset,
    ]);

    const transactions = rows.map((r) => {
      const baseAmount = Number(r.base_amount);
      const usdValue = Number(r.usd_value);
      return {
        id: r.id,
        signature: r.signature,
        timestamp: Number(r.timestamp),
        type: r.side as "buy" | "sell",
        price_usd: baseAmount > 0 ? usdValue / baseAmount : 0,
        amount: baseAmount,
        total_usd: usdValue,
        maker_address: r.trader_wallet,
        wallet_label: r.wallet_label ?? null,
        dex: r.dex,
      };
    });

    const queryTimeMs = Math.round((performance.now() - start) * 100) / 100;

    return NextResponse.json({
      pool_address: poolAddress,
      total,
      showing: transactions.length,
      page,
      limit,
      query_time_ms: queryTimeMs,
      transactions,
    });
  } catch (e) {
    console.error("GET /api/pool/[poolAddress]/transactions error:", e);
    return NextResponse.json(
      { error: "Failed to fetch transactions" },
      { status: 500 }
    );
  }
}
