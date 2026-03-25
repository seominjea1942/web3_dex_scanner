import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import type { RowDataPacket, Pool as MysqlPool } from "mysql2/promise";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Map frontend event type filters to v2 schema event_type values
const EVENT_TYPE_MAP: Record<string, string[]> = {
  liquidity: ["liquidity_add", "liquidity_remove"],
  swap: ["large_trade"],
};

// ── Lazy event generation ──────────────────────────────────────────
// Same pattern as /api/metrics: when the newest event is older than
// STALE_SEC, clone a batch of recent events with fresh timestamps
// so the demo always looks "live".
const STALE_SEC = 30;
// Generate a small, random number of events each cycle for a natural feel
const replayBatchSize = () => 1 + Math.floor(Math.random() * 3); // 1-3 events

const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const randomBase58 = (len: number) => {
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
};

async function lazyGenerateEvents(db: MysqlPool) {
  // Check staleness
  const [ageRows] = await db.query<RowDataPacket[]>(
    `SELECT (UNIX_TIMESTAMP() - MAX(timestamp) / 1000) as age FROM defi_events`
  );
  const age = Number((ageRows[0] as Record<string, unknown>)?.age ?? 0);
  if (age < STALE_SEC) return; // fresh enough

  // Pick a random sample of recent events as templates
  const [templates] = await db.query<RowDataPacket[]>(
    `SELECT event_type, severity, pool_address, dex, usd_value, description
     FROM defi_events
     ORDER BY timestamp DESC
     LIMIT 200`
  );
  if (templates.length === 0) return;

  const nowMs = Date.now();
  const placeholders: string[] = [];
  const values: (string | number)[] = [];

  const batchSize = replayBatchSize();
  for (let i = 0; i < batchSize; i++) {
    const tmpl = templates[Math.floor(Math.random() * templates.length)];

    // Mutate: fresh wallet, slightly varied amount, spread timestamps
    const wallet = randomBase58(44);
    const amountMult = 0.5 + Math.random() * 1.5; // ±50-150%
    const usdValue = Math.round(Number(tmpl.usd_value) * amountMult * 100) / 100;
    const ts = nowMs - i * (2000 + Math.floor(Math.random() * 8000)); // stagger 2-10s apart

    // Rebuild description with new amount
    let desc = String(tmpl.description || "");
    // Replace dollar amounts like "$1,234.56" or "$1234" with new value
    desc = desc.replace(
      /\$[\d,.]+[KMB]?/gi,
      "$" + (usdValue >= 1000 ? (usdValue / 1000).toFixed(1) + "K" : usdValue.toFixed(0))
    );
    // Replace wallet snippets like "aBcD...xYzW" with new wallet
    desc = desc.replace(
      /[A-Za-z0-9]{4}\.\.\.[A-Za-z0-9]{4}/g,
      wallet.slice(0, 4) + "..." + wallet.slice(-4)
    );

    placeholders.push("(?, ?, ?, ?, ?, ?, ?, ?)");
    values.push(
      tmpl.event_type,
      ts,
      tmpl.pool_address || "",
      tmpl.dex || "",
      tmpl.severity || "medium",
      wallet,
      usdValue,
      desc
    );
  }

  await db.execute(
    `INSERT INTO defi_events
     (event_type, timestamp, pool_address, dex, severity, trader_wallet, usd_value, description)
     VALUES ${placeholders.join(", ")}`,
    values
  );
}

// ── GET handler ────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const db = getPool();
    const params = req.nextUrl.searchParams;

    // Lazy-generate fresh events so the demo stays live
    try {
      await lazyGenerateEvents(db);
    } catch (genErr) {
      console.warn("Event generation skipped:", genErr);
    }

    const type = params.get("type"); // comma-separated: "whale,new_pool,liquidity,smart_money"
    const limit = Math.min(100, Math.max(1, parseInt(params.get("limit") || "30")));
    const offset = Math.max(0, parseInt(params.get("offset") || "0"));
    const minAmount = parseFloat(params.get("min_amount") || "0");

    let where = "WHERE 1=1";
    const queryParams: (string | number)[] = [];

    if (type) {
      const types = type.split(",").map((t) => t.trim()).filter(Boolean);
      // Expand frontend types to v2 types
      const v2Types: string[] = [];
      for (const t of types) {
        if (EVENT_TYPE_MAP[t]) {
          v2Types.push(...EVENT_TYPE_MAP[t]);
        } else {
          v2Types.push(t);
        }
      }
      if (v2Types.length > 0) {
        where += ` AND event_type IN (${v2Types.map(() => "?").join(",")})`;
        queryParams.push(...v2Types);
      }
    }

    if (minAmount > 0) {
      where += " AND usd_value >= ?";
      queryParams.push(minAmount);
    }

    // v2: alias columns to old names for frontend compatibility
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT *,
        FROM_UNIXTIME(timestamp / 1000) as created_at,
        trader_wallet as wallet_address,
        usd_value as amount_usd,
        dex as dex_name,
        (UNIX_TIMESTAMP() - timestamp / 1000) as seconds_ago,
        pool_address,
        severity
       FROM defi_events ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
      [...queryParams, limit, offset]
    );

    return NextResponse.json({ events: rows });
  } catch (e) {
    console.error("GET /api/events error:", e);
    return NextResponse.json({ error: "Failed to fetch events" }, { status: 500 });
  }
}
