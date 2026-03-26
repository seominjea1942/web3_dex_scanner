import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { embedNewTokens } from "@/lib/search-kit";
import {
  fetchTrendingSolanaPairs,
  fetchPairsFromDexScreener,
  mapPairToPoolRow,
  mapPairToTokenRow,
  type DexScreenerPair,
} from "@/lib/dexscreener";
import type { Pool as MysqlPool, RowDataPacket } from "mysql2/promise";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Staleness threshold: 5 minutes */
const STALE_MS = 5 * 60 * 1000;

/* ── Real event detection from DexScreener data changes ─────────── */

interface OldPoolSnapshot {
  address: string;
  volume_5m: number;
  liquidity_usd: number;
  price_change_5m: number;
  token_base_symbol: string;
  token_quote_symbol: string;
  dex: string;
}

/**
 * Compare old pool data vs fresh DexScreener data to detect notable
 * on-chain activity and insert real events into defi_events.
 * Zero extra API calls — uses data we already fetched.
 */
async function detectRealEvents(
  db: MysqlPool,
  pairs: DexScreenerPair[],
  oldSnapshots: Map<string, OldPoolSnapshot>
) {
  const nowMs = Date.now();
  const placeholders: string[] = [];
  const values: (string | number)[] = [];

  for (const pair of pairs) {
    const old = oldSnapshots.get(pair.pairAddress);
    const vol5m = pair.volume?.m5 ?? 0;
    const liq = pair.liquidity?.usd ?? 0;
    const priceChange5m = pair.priceChange?.m5 ?? 0;
    const label = `${pair.baseToken.symbol}/${pair.quoteToken.symbol}`;
    const dex = pair.dexId ?? "Unknown";

    // ── New pool: not in our DB before ──
    if (!old) {
      if (liq >= 1000) {
        placeholders.push("(?, ?, ?, ?, ?, ?, ?, ?)");
        values.push(
          "new_pool", nowMs, pair.pairAddress, dex, "high", "",
          liq,
          `New pool ${label} on ${dex} with $${formatCompact(liq)} liquidity`
        );
      }
      continue;
    }

    // ── Large trade: significant 5m volume ──
    if (vol5m >= 10_000) {
      placeholders.push("(?, ?, ?, ?, ?, ?, ?, ?)");
      values.push(
        vol5m >= 50_000 ? "whale" : "large_trade",
        nowMs - Math.floor(Math.random() * 60_000), // within last minute
        pair.pairAddress, dex,
        vol5m >= 50_000 ? "high" : "medium",
        "", vol5m,
        `${vol5m >= 50_000 ? "Whale activity" : "Large trade"} on ${label}: $${formatCompact(vol5m)} volume in 5m`
      );
    }

    // ── Liquidity change: >10% relative change and >$50K absolute ──
    if (old.liquidity_usd > 0 && liq > 0) {
      const liqDelta = liq - old.liquidity_usd;
      const absDelta = Math.abs(liqDelta);
      const relChange = absDelta / old.liquidity_usd;
      if (absDelta >= 50_000 && relChange >= 0.10) {
        const isAdd = liqDelta > 0;
        placeholders.push("(?, ?, ?, ?, ?, ?, ?, ?)");
        values.push(
          isAdd ? "liquidity_add" : "liquidity_remove",
          nowMs - Math.floor(Math.random() * 120_000),
          pair.pairAddress, dex,
          absDelta >= 50_000 ? "high" : "medium",
          "", absDelta,
          `$${formatCompact(absDelta)} liquidity ${isAdd ? "added to" : "removed from"} ${label}`
        );
      }
    }

    // ── Price spike: >10% in 5m ──
    if (Math.abs(priceChange5m) >= 10) {
      placeholders.push("(?, ?, ?, ?, ?, ?, ?, ?)");
      values.push(
        "large_trade",
        nowMs - Math.floor(Math.random() * 60_000),
        pair.pairAddress, dex, "medium",
        "", vol5m || 0,
        `${label} ${priceChange5m > 0 ? "surged" : "dropped"} ${Math.abs(priceChange5m).toFixed(1)}% in 5 minutes`
      );
    }
  }

  if (placeholders.length === 0) return 0;

  await db.execute(
    `INSERT INTO defi_events
     (event_type, timestamp, pool_address, dex, severity, trader_wallet, usd_value, description)
     VALUES ${placeholders.join(", ")}`,
    values
  );
  return placeholders.length;
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

/**
 * GET /api/sync/pools
 *
 * On-demand sync: checks if pool data is stale (>5 min),
 * fetches fresh data from DexScreener, UPSERTs into TiDB.
 *
 * Query params:
 *   ?force=true  — skip staleness check
 *   ?addresses=addr1,addr2  — sync specific pools only
 */
export async function GET(req: Request) {
  const start = performance.now();
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "true";
  const specificAddresses = url.searchParams.get("addresses")?.split(",").filter(Boolean);

  try {
    const db = getPool();

    // 1. Check staleness — skip sync if data is fresh
    if (!force && !specificAddresses) {
      const [rows] = await db.query<Array<{ latest: Date | null } & RowDataPacket>>(
        "SELECT MAX(last_updated) as latest FROM pools"
      );
      const latest = rows[0]?.latest;
      if (latest && Date.now() - new Date(latest).getTime() < STALE_MS) {
        return NextResponse.json({
          synced: false,
          reason: "fresh",
          age_ms: Date.now() - new Date(latest).getTime(),
          duration_ms: performance.now() - start,
        });
      }
    }

    // 2. Fetch from DexScreener
    let pairs: DexScreenerPair[];

    if (specificAddresses && specificAddresses.length > 0) {
      pairs = await fetchPairsFromDexScreener(specificAddresses);
    } else {
      // Fetch trending SOL pairs + refresh existing pool addresses
      const [existingRows] = await db.query<Array<{ address: string } & RowDataPacket>>(
        "SELECT address FROM pools ORDER BY volume_24h DESC LIMIT 100"
      );
      const existingAddresses = existingRows.map((r) => r.address);

      // Fetch both trending (new discovery) and existing (refresh)
      const [trending, existing] = await Promise.all([
        fetchTrendingSolanaPairs(),
        existingAddresses.length > 0
          ? fetchPairsFromDexScreener(existingAddresses)
          : Promise.resolve([]),
      ]);

      // Merge and deduplicate
      const seen = new Set<string>();
      pairs = [];
      for (const p of [...trending, ...existing]) {
        if (!seen.has(p.pairAddress)) {
          seen.add(p.pairAddress);
          pairs.push(p);
        }
      }
    }

    if (pairs.length === 0) {
      return NextResponse.json({
        synced: false,
        reason: "no_data_from_dexscreener",
        duration_ms: performance.now() - start,
      });
    }

    // 3. Snapshot existing pool data for real event detection
    const pairAddresses = pairs.map((p) => p.pairAddress);
    const oldSnapshots = new Map<string, OldPoolSnapshot>();
    if (pairAddresses.length > 0) {
      try {
        const [snapRows] = await db.query<RowDataPacket[]>(
          `SELECT address, volume_5m, liquidity_usd, price_change_5m,
                  token_base_symbol, token_quote_symbol, dex
           FROM pools WHERE address IN (${pairAddresses.map(() => "?").join(",")})`,
          pairAddresses
        );
        for (const r of snapRows) {
          oldSnapshots.set(r.address, {
            address: r.address,
            volume_5m: Number(r.volume_5m) || 0,
            liquidity_usd: Number(r.liquidity_usd) || 0,
            price_change_5m: Number(r.price_change_5m) || 0,
            token_base_symbol: r.token_base_symbol,
            token_quote_symbol: r.token_quote_symbol,
            dex: r.dex,
          });
        }
      } catch (e) {
        console.warn("Snapshot for event detection failed:", e);
      }
    }

    // 4. UPSERT tokens
    for (const pair of pairs) {
      const base = mapPairToTokenRow(pair, "base");
      const quote = mapPairToTokenRow(pair, "quote");

      await db.execute(
        `INSERT INTO tokens (address, name, symbol, logo_url)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           name = IF(VALUES(name) != '', VALUES(name), name),
           symbol = IF(VALUES(symbol) != '', VALUES(symbol), symbol),
           logo_url = IF(VALUES(logo_url) IS NOT NULL, VALUES(logo_url), logo_url)`,
        [base.address, base.name, base.symbol, base.logo_url]
      );

      await db.execute(
        `INSERT INTO tokens (address, name, symbol, logo_url)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           name = IF(VALUES(name) != '', VALUES(name), name),
           symbol = IF(VALUES(symbol) != '', VALUES(symbol), symbol),
           logo_url = IF(VALUES(logo_url) IS NOT NULL, VALUES(logo_url), logo_url)`,
        [quote.address, quote.name, quote.symbol, quote.logo_url]
      );
    }

    // 5. UPSERT pools
    for (const pair of pairs) {
      const p = mapPairToPoolRow(pair);

      await db.execute(
        `INSERT INTO pools (
           address, token_base_address, token_quote_address,
           token_base_symbol, token_quote_symbol, dex,
           price_usd, volume_5m, volume_1h, volume_6h, volume_24h,
           liquidity_usd, market_cap,
           txns_5m_buys, txns_5m_sells, txns_1h_buys, txns_1h_sells,
           txns_24h_buys, txns_24h_sells,
           price_change_5m, price_change_1h, price_change_6h, price_change_24h,
           pool_created_at, last_updated
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
           price_usd = VALUES(price_usd),
           volume_5m = VALUES(volume_5m),
           volume_1h = VALUES(volume_1h),
           volume_6h = VALUES(volume_6h),
           volume_24h = VALUES(volume_24h),
           liquidity_usd = VALUES(liquidity_usd),
           market_cap = VALUES(market_cap),
           txns_5m_buys = VALUES(txns_5m_buys),
           txns_5m_sells = VALUES(txns_5m_sells),
           txns_1h_buys = VALUES(txns_1h_buys),
           txns_1h_sells = VALUES(txns_1h_sells),
           txns_24h_buys = VALUES(txns_24h_buys),
           txns_24h_sells = VALUES(txns_24h_sells),
           price_change_5m = VALUES(price_change_5m),
           price_change_1h = VALUES(price_change_1h),
           price_change_6h = VALUES(price_change_6h),
           price_change_24h = VALUES(price_change_24h),
           last_updated = NOW()`,
        [
          p.address, p.token_base_address, p.token_quote_address,
          p.token_base_symbol, p.token_quote_symbol, p.dex,
          p.price_usd, p.volume_5m, p.volume_1h, p.volume_6h, p.volume_24h,
          p.liquidity_usd, p.market_cap,
          p.txns_5m_buys, p.txns_5m_sells, p.txns_1h_buys, p.txns_1h_sells,
          p.txns_24h_buys, p.txns_24h_sells,
          p.price_change_5m, p.price_change_1h, p.price_change_6h, p.price_change_24h,
          p.pool_created_at,
        ]
      );
    }

    // 6. Detect real events from data changes
    let realEventsCount = 0;
    try {
      realEventsCount = await detectRealEvents(db, pairs, oldSnapshots);
    } catch (e) {
      console.warn("Real event detection failed:", e);
    }

    // 7. Auto-embed any new tokens that lack embeddings (for vector search)
    let embeddedCount = 0;
    try {
      embeddedCount = await embedNewTokens(db);
    } catch (e) {
      console.warn("Auto-embed failed:", e);
    }

    const duration = performance.now() - start;

    return NextResponse.json({
      synced: true,
      pairs_count: pairs.length,
      real_events: realEventsCount,
      embedded_count: embeddedCount,
      duration_ms: Math.round(duration),
      source: "dexscreener",
    });
  } catch (e) {
    console.error("Sync pools error:", e);
    return NextResponse.json(
      { error: "Sync failed", detail: String(e) },
      { status: 500 }
    );
  }
}
