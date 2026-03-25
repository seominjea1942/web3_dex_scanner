import { NextRequest, NextResponse } from "next/server";
import { getPool, withTiKV } from "@/lib/db";
import {
  classifyQuery,
  getQueryEmbedding,
  rrfMerge,
  getSearchEngineLabel,
  parseQueryFilters,
  buildFilterSQL,
  deduplicateByToken,
  type QueryIntent,
  type RankedResult,
  type SearchFilter,
} from "@/lib/search-kit";
import type { RowDataPacket, Pool, PoolConnection } from "mysql2/promise";

type DB = Pool | PoolConnection;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STOP_WORDS = new Set([
  "find", "search", "show", "get", "tokens", "token", "coins", "coin",
  "pools", "pool", "similar", "to", "around", "activity",
  "whale", "whales", "this", "week", "today", "moving", "the", "a",
  "an", "for", "with", "that", "are", "is", "in", "on", "by",
]);

function extractSearchTerms(query: string): string {
  const words = query.toLowerCase().split(/\s+/);
  const meaningful = words.filter((w) => !STOP_WORDS.has(w) && w.length >= 2);
  return meaningful.length > 0 ? meaningful.join(" ") : query;
}

/* ── Main handler ────────────────────────────────────────── */

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() || "";
  if (q.length < 2)
    return NextResponse.json({
      tokens: [],
      events: [],
      search_engine: "none",
      search_strategy: "none",
    });

  const db = getPool();
  const start = performance.now();

  // Parse natural language filters from query: "dog coins under $1" → search "dog coins" + filter price ≤ $1
  const parsed = parseQueryFilters(q);
  const filters = parsed.filters;
  const effectiveQuery = parsed.searchText || q;

  const searchTerms = extractSearchTerms(effectiveQuery);
  const queryInterpreted =
    searchTerms !== effectiveQuery.toLowerCase() ? searchTerms : undefined;

  // If after stop word removal we have no meaningful search text but have filters, do a filter-only query
  const allStopWords = effectiveQuery.toLowerCase().split(/\s+/).every((w) => STOP_WORDS.has(w) || w.length < 2);
  const isFilterOnly = filters.length > 0 && allStopWords;

  const intent: QueryIntent = isFilterOnly ? "fts" : classifyQuery(effectiveQuery);

  try {
    let tokens: Record<string, any>[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    let events: RowDataPacket[] = [];
    let usedVector = false;

    // Filter-only queries: skip text search, just apply numeric filters to all pools
    if (isFilterOnly) {
      tokens = await withTiKV((conn) => searchFilterOnly(conn, filters));
    } else

    // address/exact_symbol/prefix use TiKV (B-tree indexes) to avoid TiFlash sync issues
    // fts/semantic/hybrid use pool directly (FTS + Vector both need TiFlash)
    switch (intent) {
      case "address":
        tokens = await withTiKV((conn) => searchByAddress(conn, q));
        break;

      case "exact_symbol":
        tokens = await withTiKV((conn) => searchExactSymbol(conn, q));
        break;

      case "prefix":
        tokens = await withTiKV((conn) => searchPrefix(conn, q));
        break;

      case "semantic":
        tokens = await searchVector(db, q);
        usedVector = tokens.length > 0;
        if (!usedVector) {
          const ftsResult = await searchFTS(db, searchTerms);
          tokens = ftsResult.tokens;
          events = ftsResult.events;
        }
        break;

      case "hybrid": {
        const [ftsResult, vectorTokens] = await Promise.all([
          searchFTS(db, searchTerms),
          searchVector(db, q),
        ]);
        events = ftsResult.events;

        if (vectorTokens.length > 0 && ftsResult.tokens.length > 0) {
          usedVector = true;
          const ftsList: RankedResult[] = ftsResult.tokens.map((t) => ({
            key: t.token_base_address,
            data: t,
          }));
          const vecList: RankedResult[] = vectorTokens.map((t) => ({
            key: t.token_base_address,
            data: t,
          }));

          const merged = rrfMerge([
            { name: "fts", results: ftsList },
            { name: "vector", results: vecList },
          ]);

          tokens = merged.map((m) => ({
            ...m.data,
            _sources: m.sources,
            _rrfScore: m.rrfScore,
          }));
        } else if (vectorTokens.length > 0) {
          tokens = vectorTokens;
          usedVector = true;
        } else {
          tokens = ftsResult.tokens;
        }
        break;
      }

      case "fts":
      default: {
        const ftsResult = await searchFTS(db, searchTerms);
        tokens = ftsResult.tokens;
        events = ftsResult.events;

        // Vector fallback if FTS returns nothing
        if (tokens.length === 0) {
          const vectorTokens = await searchVector(db, q);
          if (vectorTokens.length > 0) {
            tokens = vectorTokens;
            usedVector = true;
          }
        }
        break;
      }
    }

    // Deduplicate: keep only the best pool per unique token
    tokens = deduplicateByToken(tokens);

    // Apply parsed numeric filters (e.g., "under $1" → price_usd <= 1)
    if (filters.length > 0) {
      tokens = tokens.filter((t) =>
        filters.every((f) => {
          const val = Number(t[f.field]);
          if (isNaN(val)) return false;
          switch (f.op) {
            case ">=": return val >= f.value;
            case "<=": return val <= f.value;
            case ">": return val > f.value;
            case "<": return val < f.value;
            case "=": return val === f.value;
            default: return true;
          }
        })
      );
    }

    // Enrich with safety + whale data (uses TiKV for reliable reads)
    tokens = await withTiKV((conn) => enrichTokens(conn, tokens));

    // Sort: RRF score > relevance > volume (volume breaks ties)
    tokens = tokens
      .sort((a, b) => {
        if (a._rrfScore && b._rrfScore) return b._rrfScore - a._rrfScore;
        const relDiff = (b.relevance || 0) - (a.relevance || 0);
        if (Math.abs(relDiff) > 0.01) return relDiff;
        return Number(b.volume_24h || 0) - Number(a.volume_24h || 0);
      })
      .slice(0, 10);

    const searchEngine = getSearchEngineLabel(intent, usedVector);
    const queryTimeMs = Math.round(performance.now() - start);

    return NextResponse.json({
      tokens,
      events,
      search_engine: searchEngine,
      search_strategy: intent,
      query_interpreted: queryInterpreted,
      filters_applied: filters.map((f) => f.label),
      query_time_ms: queryTimeMs,
    });
  } catch (err) {
    console.error("[search] Search failed, using LIKE fallback:", err);
    return likeFallback(db, q, start, queryInterpreted);
  }
}

/* ── Search Strategies ───────────────────────────────────── */

async function searchFilterOnly(
  db: DB,
  filters: SearchFilter[]
) {
  const { where, params } = buildFilterSQL(filters);
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT p.address, p.token_base_symbol, p.token_quote_symbol,
            p.token_base_address, p.price_usd, p.volume_24h,
            p.price_change_24h, p.dex, p.pool_created_at,
            p.txns_24h_buys, p.txns_24h_sells,
            p.liquidity_usd, p.market_cap,
            t.logo_url, t.name AS token_name
     FROM pools p
     LEFT JOIN tokens t ON p.token_base_address = t.address
     WHERE 1=1 ${where}
     ORDER BY p.volume_24h DESC
     LIMIT 50`,
    params
  );
  return rows;
}

async function searchByAddress(
  db: DB,
  address: string
) {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT p.address, p.token_base_symbol, p.token_quote_symbol,
            p.token_base_address, p.price_usd, p.volume_24h,
            p.price_change_24h, p.dex, p.pool_created_at,
            p.txns_24h_buys, p.txns_24h_sells,
            p.liquidity_usd, p.market_cap,
            t.logo_url, t.name AS token_name
     FROM pools p
     LEFT JOIN tokens t ON p.token_base_address = t.address
     WHERE p.address = ? OR p.token_base_address = ?
     ORDER BY p.volume_24h DESC
     LIMIT 10`,
    [address, address]
  );
  return rows;
}

async function searchExactSymbol(
  db: DB,
  symbol: string
) {
  const upper = symbol.toUpperCase();
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT p.address, p.token_base_symbol, p.token_quote_symbol,
            p.token_base_address, p.price_usd, p.volume_24h,
            p.price_change_24h, p.dex, p.pool_created_at,
            p.txns_24h_buys, p.txns_24h_sells,
            p.liquidity_usd, p.market_cap,
            t.logo_url, t.name AS token_name
     FROM pools p
     LEFT JOIN tokens t ON p.token_base_address = t.address
     WHERE p.token_base_symbol = ?
     ORDER BY p.volume_24h DESC
     LIMIT 10`,
    [upper]
  );
  return rows;
}

async function searchPrefix(
  db: DB,
  prefix: string
) {
  const like = `${prefix.toUpperCase()}%`;
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT p.address, p.token_base_symbol, p.token_quote_symbol,
            p.token_base_address, p.price_usd, p.volume_24h,
            p.price_change_24h, p.dex, p.pool_created_at,
            p.txns_24h_buys, p.txns_24h_sells,
            p.liquidity_usd, p.market_cap,
            t.logo_url, t.name AS token_name
     FROM pools p
     LEFT JOIN tokens t ON p.token_base_address = t.address
     WHERE p.token_base_symbol LIKE ?
     ORDER BY p.volume_24h DESC
     LIMIT 20`,
    [like]
  );
  return rows;
}

async function searchFTS(
  db: DB,
  searchTerms: string
): Promise<{ tokens: Record<string, any>[]; events: RowDataPacket[] }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  // Parallel FTS on symbols, token names, event descriptions
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
      .catch(() => [[] as RowDataPacket[]]),
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

  // Merge & dedup pools by token_base_address (keep highest-volume)
  const byToken = new Map<string, Record<string, any>>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const r of symbolRows[0]) {
    const tokenInfo = tokenMap.get(r.token_base_address);
    const entry: Record<string, any> = { // eslint-disable-line @typescript-eslint/no-explicit-any
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
    const tokenAddrs = Array.from(tokenMap.keys()).filter(
      (a) => !byToken.has(a)
    );
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

  // Enrich events with token symbol
  const eventData = (eventRows as RowDataPacket[])[0] ?? eventRows ?? [];
  const eventList = Array.isArray(eventData) ? eventData : [];
  if (eventList.length > 0) {
    const eventPoolAddrs = Array.from(
      new Set(
        eventList.map((e: RowDataPacket) => e.pool_address).filter(Boolean)
      )
    );
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

  return {
    tokens: Array.from(byToken.values()),
    events: eventList,
  };
}

async function searchVector(
  db: DB,
  query: string
): Promise<Record<string, any>[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const embedding = await getQueryEmbedding(query);
  if (!embedding) return [];

  const vecString = `[${embedding.join(",")}]`;

  try {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT t.address AS token_address, t.name AS token_name,
              t.symbol, t.logo_url,
              VEC_COSINE_DISTANCE(t.embedding, ?) AS distance
       FROM tokens t
       WHERE t.embedding IS NOT NULL
       ORDER BY VEC_COSINE_DISTANCE(t.embedding, ?)
       LIMIT 20`,
      [vecString, vecString]
    );

    if (rows.length === 0) return [];

    // Look up pools for matched tokens
    const tokenAddrs = rows.map((r) => r.token_address);
    const placeholders = tokenAddrs.map(() => "?").join(",");
    const [poolRows] = await db.query<RowDataPacket[]>(
      `SELECT p.address, p.token_base_symbol, p.token_quote_symbol,
              p.token_base_address, p.price_usd, p.volume_24h,
              p.price_change_24h, p.dex, p.pool_created_at,
              p.txns_24h_buys, p.txns_24h_sells
       FROM pools p
       WHERE p.token_base_address IN (${placeholders})
       ORDER BY p.volume_24h DESC`,
      tokenAddrs
    );

    // Build token info map from vector results
    const tokenInfoMap = new Map<string, { name: string; logo_url: string | null; distance: number }>();
    for (const r of rows) {
      tokenInfoMap.set(r.token_address, {
        name: r.token_name,
        logo_url: r.logo_url,
        distance: Number(r.distance),
      });
    }

    // Merge: one pool per token (highest volume)
    const byToken = new Map<string, Record<string, any>>(); // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const p of poolRows) {
      const info = tokenInfoMap.get(p.token_base_address);
      const existing = byToken.get(p.token_base_address);
      if (!existing || Number(p.volume_24h) > Number(existing.volume_24h)) {
        byToken.set(p.token_base_address, {
          ...p,
          token_name: info?.name ?? null,
          logo_url: info?.logo_url ?? null,
          relevance: info ? 1 - info.distance : 0, // cosine similarity
          _vector_distance: info?.distance,
        });
      }
    }

    return Array.from(byToken.values());
  } catch (err) {
    console.error("[search] Vector search failed:", err);
    return [];
  }
}

/* ── Enrichment ──────────────────────────────────────────── */

async function enrichTokens(
  db: DB,
  tokens: Record<string, any>[] // eslint-disable-line @typescript-eslint/no-explicit-any
): Promise<Record<string, any>[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (tokens.length === 0) return tokens;

  const tokenAddresses = tokens.map(
    (t) => t.token_base_address || t.token_address
  ).filter(Boolean);
  const poolAddresses = tokens.map((t) => t.address).filter(Boolean);

  if (tokenAddresses.length === 0) return tokens;

  const tPlaceholders = tokenAddresses.map(() => "?").join(",");
  const pPlaceholders = poolAddresses.length > 0
    ? poolAddresses.map(() => "?").join(",")
    : "'__none__'";

  const [safetyRows, whaleRows] = await Promise.all([
    db
      .query<RowDataPacket[]>(
        `SELECT token_address, holder_count, top10_holder_pct
         FROM token_safety
         WHERE token_address IN (${tPlaceholders})`,
        tokenAddresses
      )
      .catch(() => [[] as RowDataPacket[]]),
    poolAddresses.length > 0
      ? db.query<RowDataPacket[]>(
          `SELECT pool_address, COUNT(*) AS whale_count
           FROM defi_events
           WHERE pool_address IN (${pPlaceholders})
             AND event_type IN ('whale', 'smart_money')
           GROUP BY pool_address`,
          poolAddresses
        )
      : Promise.resolve([[] as RowDataPacket[]]),
  ]);

  const safetyMap = new Map<string, { holder_count: number; top10_holder_pct: number }>();
  const safetyData = (safetyRows as RowDataPacket[])[0] ?? safetyRows ?? [];
  const safetyList = Array.isArray(safetyData) ? safetyData : [];
  for (const s of safetyList) {
    safetyMap.set(s.token_address, {
      holder_count: s.holder_count ?? 0,
      top10_holder_pct: Number(s.top10_holder_pct) || 0,
    });
  }

  const whaleMap = new Map<string, number>();
  const whaleData = (whaleRows as RowDataPacket[])[0] ?? whaleRows ?? [];
  const whaleList = Array.isArray(whaleData) ? whaleData : [];
  for (const w of whaleList) {
    whaleMap.set(w.pool_address, Number(w.whale_count));
  }

  for (const row of tokens) {
    const addr = row.token_base_address || row.token_address;
    const safety = safetyMap.get(addr);
    row.holder_count = safety?.holder_count ?? null;
    row.top10_holder_pct = safety?.top10_holder_pct ?? null;
    row.txns_24h =
      (Number(row.txns_24h_buys) || 0) + (Number(row.txns_24h_sells) || 0);
    row.whale_events_24h = whaleMap.get(row.address) ?? 0;
  }

  return tokens;
}

/* ── LIKE Fallback ───────────────────────────────────────── */

async function likeFallback(
  db: DB,
  q: string,
  start: number,
  queryInterpreted: string | undefined
) {
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
    search_strategy: "fts",
    query_interpreted: queryInterpreted,
    query_time_ms: queryTimeMs,
  });
}
