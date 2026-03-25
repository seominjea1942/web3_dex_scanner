import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import type { RowDataPacket } from "mysql2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STOP_WORDS = new Set([
  "find", "search", "show", "get", "tokens", "token", "coins", "coin",
  "pools", "pool", "like", "similar", "to", "around", "activity",
  "whale", "whales", "this", "week", "today", "moving", "the", "a",
  "an", "for", "with", "that", "are", "is", "in", "on", "by",
]);

function extractSearchTerms(query: string): string {
  const words = query.toLowerCase().split(/\s+/);
  const meaningful = words.filter((w) => !STOP_WORDS.has(w) && w.length >= 2);
  return meaningful.length > 0 ? meaningful.join(" ") : query;
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() || "";
  if (q.length < 2)
    return NextResponse.json({ tokens: [], events: [], search_engine: "none" });

  const db = getPool();
  const start = performance.now();
  const searchTerms = extractSearchTerms(q);
  const queryInterpreted =
    searchTerms !== q.toLowerCase() ? searchTerms : undefined;

  // ── FTS path ──────────────────────────────────────────────
  try {
    // Round 1: parallel FTS on symbols, token names, and event descriptions
    const [symbolRows, nameRows, eventRows] = await Promise.all([
      db.query<RowDataPacket[]>(
        `SELECT
          p.address, p.token_base_symbol, p.token_quote_symbol,
          p.token_base_address, p.price_usd, p.volume_24h,
          p.price_change_24h, p.dex, p.pool_created_at,
          p.txns_24h_buys, p.txns_24h_sells,
          fts_match_word(?, p.token_base_symbol) AS relevance
        FROM pools p
        WHERE fts_match_word(?, p.token_base_symbol)
        ORDER BY fts_match_word(?, p.token_base_symbol) DESC
        LIMIT 50`,
        [searchTerms, searchTerms, searchTerms]
      ),
      db.query<RowDataPacket[]>(
        `SELECT
          t.address AS token_address, t.name AS token_name, t.logo_url,
          fts_match_word(?, t.name) AS relevance
        FROM tokens t
        WHERE fts_match_word(?, t.name)
        ORDER BY fts_match_word(?, t.name) DESC
        LIMIT 20`,
        [searchTerms, searchTerms, searchTerms]
      ),
      // Event FTS — search descriptions like "Whale bought $120K of BONK"
      db
        .query<RowDataPacket[]>(
          `SELECT
          de.id, de.event_type, de.severity, de.description,
          de.usd_value, de.pool_address, de.timestamp, de.dex,
          de.trader_wallet,
          fts_match_word(?, de.description) AS relevance
        FROM defi_events de
        WHERE fts_match_word(?, de.description)
        ORDER BY fts_match_word(?, de.description) DESC
        LIMIT 5`,
          [searchTerms, searchTerms, searchTerms]
        )
        .catch(() => [[] as RowDataPacket[]]), // graceful if no FTS index on events
    ]);

    // Build token lookup from name-matched results
    const tokenMap = new Map<
      string,
      { name: string; logo_url: string | null; relevance: number }
    >();
    for (const t of nameRows[0]) {
      tokenMap.set(t.token_address, {
        name: t.token_name,
        logo_url: t.logo_url,
        relevance: Number(t.relevance),
      });
    }

    // Merge & deduplicate pools by token_base_address (keep highest-volume)
    const byToken = new Map<string, RowDataPacket>();
    for (const r of symbolRows[0]) {
      const tokenInfo = tokenMap.get(r.token_base_address);
      const entry = {
        ...r,
        token_name: tokenInfo?.name ?? null,
        logo_url: tokenInfo?.logo_url ?? null,
        relevance: Number(r.relevance) + (tokenInfo?.relevance ?? 0),
      };
      const existing = byToken.get(r.token_base_address);
      if (!existing || Number(entry.volume_24h) > Number(existing.volume_24h)) {
        byToken.set(r.token_base_address, entry);
      }
    }

    // Add tokens found via name search that weren't in symbol results
    if (tokenMap.size > 0) {
      const tokenAddrs = [...tokenMap.keys()].filter((a) => !byToken.has(a));
      if (tokenAddrs.length > 0) {
        const placeholders = tokenAddrs.map(() => "?").join(",");
        const [extraPools] = await db.query<RowDataPacket[]>(
          `SELECT p.address, p.token_base_symbol, p.token_quote_symbol,
                  p.token_base_address, p.price_usd, p.volume_24h,
                  p.price_change_24h, p.dex, p.pool_created_at,
                  p.txns_24h_buys, p.txns_24h_sells
           FROM pools p
           WHERE p.token_base_address IN (${placeholders})
           ORDER BY p.volume_24h DESC`,
          tokenAddrs
        );
        for (const p of extraPools) {
          const tokenInfo = tokenMap.get(p.token_base_address);
          const existing = byToken.get(p.token_base_address);
          if (
            !existing ||
            Number(p.volume_24h) > Number(existing.volume_24h)
          ) {
            byToken.set(p.token_base_address, {
              ...p,
              token_name: tokenInfo?.name ?? null,
              logo_url: tokenInfo?.logo_url ?? null,
              relevance: tokenInfo?.relevance ?? 0,
            });
          }
        }
      }
    }

    // Round 2: enrich tokens with safety data + whale event counts
    const tokenAddresses = [...byToken.keys()];
    const poolAddresses = [...byToken.values()].map((r) => r.address);
    if (tokenAddresses.length > 0) {
      const tPlaceholders = tokenAddresses.map(() => "?").join(",");
      const pPlaceholders = poolAddresses.map(() => "?").join(",");
      const [safetyRows, whaleRows] = await Promise.all([
        db
          .query<RowDataPacket[]>(
            `SELECT token_address, holder_count, top10_holder_pct
           FROM token_safety
           WHERE token_address IN (${tPlaceholders})`,
            tokenAddresses
          )
          .catch(() => [[] as RowDataPacket[]]),
        db.query<RowDataPacket[]>(
          `SELECT pool_address, COUNT(*) AS whale_count
           FROM defi_events
           WHERE pool_address IN (${pPlaceholders})
             AND event_type IN ('whale', 'smart_money')
           GROUP BY pool_address`,
          poolAddresses
        ),
      ]);

      const safetyMap = new Map<
        string,
        { holder_count: number; top10_holder_pct: number }
      >();
      const safetyData = (safetyRows as RowDataPacket[])[0] ?? safetyRows ?? [];
      const safetyList = Array.isArray(safetyData) ? safetyData : [];
      for (const s of safetyList) {
        safetyMap.set(s.token_address, {
          holder_count: s.holder_count ?? 0,
          top10_holder_pct: Number(s.top10_holder_pct) || 0,
        });
      }
      const whaleMap = new Map<string, number>();
      for (const w of whaleRows[0]) {
        whaleMap.set(w.pool_address, Number(w.whale_count));
      }

      for (const [addr, row] of byToken) {
        const safety = safetyMap.get(addr);
        row.holder_count = safety?.holder_count ?? null;
        row.top10_holder_pct = safety?.top10_holder_pct ?? null;
        row.txns_24h =
          (Number(row.txns_24h_buys) || 0) +
          (Number(row.txns_24h_sells) || 0);
        row.whale_events_24h = whaleMap.get(row.address) ?? 0;
      }
    }

    // Enrich events with token symbol
    const events = (eventRows as RowDataPacket[])[0] ?? eventRows ?? [];
    const eventList = Array.isArray(events) ? events : [];
    if (eventList.length > 0) {
      const eventPoolAddrs = [
        ...new Set(eventList.map((e: RowDataPacket) => e.pool_address).filter(Boolean)),
      ];
      if (eventPoolAddrs.length > 0) {
        const ePlaceholders = eventPoolAddrs.map(() => "?").join(",");
        const [poolSymbols] = await db.query<RowDataPacket[]>(
          `SELECT address, token_base_symbol FROM pools WHERE address IN (${ePlaceholders})`,
          eventPoolAddrs
        );
        const symbolMap = new Map<string, string>();
        for (const p of poolSymbols) {
          symbolMap.set(p.address, p.token_base_symbol);
        }
        for (const e of eventList) {
          e.token_symbol = symbolMap.get(e.pool_address) ?? null;
        }
      }
    }

    const tokens = [...byToken.values()]
      .sort((a, b) => {
        const relDiff = b.relevance - a.relevance;
        if (Math.abs(relDiff) > 0.01) return relDiff;
        return Number(b.volume_24h) - Number(a.volume_24h);
      })
      .slice(0, 10);

    const queryTimeMs = Math.round(performance.now() - start);

    return NextResponse.json({
      tokens,
      events: eventList,
      search_engine: "tici",
      query_interpreted: queryInterpreted,
      query_time_ms: queryTimeMs,
    });
  } catch (ftsErr) {
    console.error("[search] FTS failed, using LIKE fallback:", ftsErr);
    // ── LIKE fallback ─────────────────────────────────────────
    const like = `%${q}%`;
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT
        p.address, p.token_base_symbol, p.token_quote_symbol,
        p.token_base_address, p.price_usd, p.volume_24h,
        p.price_change_24h, p.dex, p.pool_created_at,
        p.txns_24h_buys, p.txns_24h_sells,
        t.logo_url, t.name AS token_name
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

    const queryTimeMs = Math.round(performance.now() - start);

    return NextResponse.json({
      tokens: rows,
      events: [],
      search_engine: "like_fallback",
      query_interpreted: queryInterpreted,
      query_time_ms: queryTimeMs,
    });
  }
}
