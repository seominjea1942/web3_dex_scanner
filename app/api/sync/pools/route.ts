import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import {
  fetchTrendingSolanaPairs,
  fetchPairsFromDexScreener,
  mapPairToPoolRow,
  mapPairToTokenRow,
  type DexScreenerPair,
} from "@/lib/dexscreener";
import type { RowDataPacket } from "mysql2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Staleness threshold: 5 minutes */
const STALE_MS = 5 * 60 * 1000;

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

    // 3. UPSERT tokens
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

    // 4. UPSERT pools
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

    const duration = performance.now() - start;

    return NextResponse.json({
      synced: true,
      pairs_count: pairs.length,
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
