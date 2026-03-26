import { NextRequest, NextResponse } from "next/server";
import { getPool, withTiKV, withTiFlash } from "@/lib/db";
import {
  classifyQuery,
  getQueryEmbedding,
  rrfMerge,
  getSearchEngineLabel,
  parseQueryFilters,
  buildFilterSQL,
  deduplicateByToken,
  fuzzyMatchSymbol,
  setSymbolCache,
  isSymbolCacheStale,
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
  "pools", "pool", "similar", "to", "around",
  "moving", "the", "a", "an", "for", "with", "that", "are", "is",
  "in", "on", "by", "me", "what", "which", "has",
  // NOTE: "whale", "today", "this", "week" intentionally NOT stopped
  // — they carry search intent (whale activity, time filters)
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

  // Refresh symbol cache for fuzzy matching (lazy, every 5 min)
  // Must await if cache is empty — fuzzy match needs symbols loaded
  if (isSymbolCacheStale()) {
    try {
      const [rows] = await db.query<RowDataPacket[]>(
        "SELECT DISTINCT token_base_symbol AS symbol, token_base_address AS address FROM pools"
      );
      setSymbolCache(rows.map((r: any) => ({ symbol: r.symbol, address: r.address })));
    } catch { /* non-critical */ }
  }

  // Parse natural language filters from query: "dog coins under $1" → search "dog coins" + filter price ≤ $1
  const parsed = parseQueryFilters(q);
  const filters = parsed.filters;
  const dexFilter = parsed.dex;
  const dexExclude = parsed.dexExclude;
  const sortDirective = parsed.sortDirective;
  const timeFilterHours = parsed.timeFilterHours;
  const timeLabel = parsed.timeLabel;
  const heuristic = parsed.heuristic;
  const comparison = parsed.comparison;
  const effectiveQuery = parsed.searchText || q;

  const searchTerms = extractSearchTerms(effectiveQuery);
  const queryInterpreted =
    searchTerms !== effectiveQuery.toLowerCase() ? searchTerms : undefined;

  // If after stop word removal we have no meaningful search text but have filters/sort/time, do a filter-only query
  const allStopWords = effectiveQuery.toLowerCase().split(/\s+/).every((w) => STOP_WORDS.has(w) || w.length < 2);
  const hasStructuredFilters = filters.length > 0 || sortDirective || timeFilterHours !== null || dexFilter;
  const isFilterOnly = hasStructuredFilters && allStopWords;

  const intent: QueryIntent = isFilterOnly ? "fts" : classifyQuery(effectiveQuery);

  try {
    let tokens: Record<string, any>[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    let events: RowDataPacket[] = [];
    let usedVector = false;

    // Handle "vs" comparison queries
    if (comparison) {
      const [leftResults, rightResults] = await Promise.all([
        searchExactSymbol(db, comparison.left),
        searchExactSymbol(db, comparison.right),
      ]);
      // If exact symbol didn't find results, try FTS
      const left = leftResults.length > 0 ? leftResults : (await searchFTS(db, comparison.left)).tokens;
      const right = rightResults.length > 0 ? rightResults : (await searchFTS(db, comparison.right)).tokens;

      // Tag results with comparison side
      for (const t of left) t._comparison_side = "left";
      for (const t of right) t._comparison_side = "right";

      tokens = [...left.slice(0, 5), ...right.slice(0, 5)];
      tokens = deduplicateByToken(tokens);
      tokens = await enrichTokens(db, tokens);

      const queryTimeMs = Math.round(performance.now() - start);
      const response = {
        tokens,
        events: [],
        comparison: { left: comparison.left, right: comparison.right },
        search_engine: "comparison",
        search_strategy: "comparison",
        query_interpreted: `${comparison.left} vs ${comparison.right}`,
        filters_applied: ["comparison"],
        query_time_ms: queryTimeMs,
      };
      setCache(cacheKey, response);
      return NextResponse.json(response);
    }

    // Filter-only queries: use TiFlash columnar engine for analytics scans
    const filterOpts = { dex: dexFilter, dexExclude, timeFilterHours, sortDirective };
    if (isFilterOnly) {
      // TiDB optimizer auto-routes to TiFlash for full scans; no need for withTiFlash wrapper
      tokens = await searchFilterOnly(db, filters, filterOpts);
    } else

    // All search strategies use the pool directly — TiDB optimizer picks TiKV/TiFlash automatically.
    // Removing withTiKV wrappers saves 2 RTT (SET SESSION + RESET) per call.
    switch (intent) {
      case "address":
        tokens = await searchByAddress(db, q);
        break;

      case "exact_symbol": {
        // Try exact symbol match + FTS in parallel — merge results
        const [exactHits, ftsResult] = await Promise.all([
          searchExactSymbol(db, q),
          searchFTS(db, q),
        ]);
        // Exact matches first, then FTS results (name matches like "Official Trump")
        tokens = [...exactHits, ...ftsResult.tokens];
        tokens = deduplicateByToken(tokens);
        // Fuzzy fallback if still empty: "BONKK" → BONK via Levenshtein
        if (tokens.length === 0) {
          const fuzzyHits = fuzzyMatchSymbol(q);
          if (fuzzyHits.length > 0) {
            const fuzzyAddrs = fuzzyHits.map((h) => h.address);
            tokens = await searchByTokenAddresses(db, fuzzyAddrs);
            usedVector = false;
          }
        }
        break;
      }

      case "prefix":
        tokens = await searchPrefix(db, q);
        // Fuzzy fallback for short typos
        if (tokens.length === 0) {
          const fuzzyHits = fuzzyMatchSymbol(q, 1); // stricter for short prefixes
          if (fuzzyHits.length > 0) {
            const fuzzyAddrs = fuzzyHits.map((h) => h.address);
            tokens = await searchByTokenAddresses(db, fuzzyAddrs);
          }
        }
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

    // Enrich with safety + whale + stats data BEFORE filters
    // Use pool directly instead of withTiKV to avoid extra SET SESSION round-trip (~180ms saved)
    tokens = await enrichTokens(db, tokens);

    // Apply parsed numeric filters (e.g., "under $1" → price_usd <= 1)
    if (filters.length > 0) {
      tokens = tokens.filter((t) =>
        filters.every((f) => {
          // Handle special computed filter fields
          let val: number;
          if (f.field === "_mcap_vol_ratio") {
            const mcap = Number(t.market_cap || 0);
            const vol = Number(t.volume_24h || 1);
            val = vol > 0 ? mcap / vol : 9999;
          } else if (f.field === "_txn_count_24h") {
            val = (Number(t.txns_24h_buys || 0) + Number(t.txns_24h_sells || 0));
          } else if (f.field === "_buy_sell_ratio") {
            const buys = Number(t.txns_24h_buys || 0);
            const sells = Number(t.txns_24h_sells || 1);
            val = sells > 0 ? buys / sells : buys > 0 ? 999 : 1;
          } else if (f.field === "_is_verified") {
            val = Number(t.is_verified || 0);
          } else if (f.field === "_is_lp_burned") {
            val = Number(t.is_lp_burned || 0);
          } else if (f.field === "_lp_locked") {
            val = Number(t.lp_locked || 0);
          } else if (f.field === "_is_mintable") {
            val = Number(t.is_mintable ?? 1); // default to mintable (unsafe)
          } else if (f.field === "_risk_score") {
            val = Number(t.risk_score || 0);
          } else if (f.field === "_holder_count") {
            val = Number(t.holder_count || 0);
          } else if (f.field === "_unique_traders") {
            val = Number(t.unique_traders_24h || 0);
          } else if (f.field === "_whale_events") {
            val = Number(t.whale_events_24h || 0);
          } else if (f.field === "_sector_query") {
            val = 1; // always pass — sector results handled separately
          } else {
            val = Number(t[f.field]);
          }
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

    // Apply DEX filter (in-memory for non-filter-only queries)
    if (dexFilter && !isFilterOnly) {
      const dexLower = dexFilter.toLowerCase();
      if (dexExclude) {
        // "not on jupiter" → exclude this DEX
        tokens = tokens.filter((t) => (t.dex || "").toLowerCase() !== dexLower);
      } else {
        tokens = tokens.filter((t) => (t.dex || "").toLowerCase() === dexLower);
      }
    }

    // Apply time filter (in-memory for non-filter-only queries)
    if (timeFilterHours !== null && !isFilterOnly) {
      const nowMs = Date.now();
      if (timeFilterHours > 0) {
        // "last N hours" — created within
        const thresholdMs = nowMs - timeFilterHours * 3600 * 1000;
        tokens = tokens.filter((t) => {
          const ts = t.pool_created_at ? new Date(t.pool_created_at).getTime() : 0;
          return ts >= thresholdMs;
        });
      } else if (timeFilterHours < 0) {
        // "older than N hours"
        const thresholdMs = nowMs - Math.abs(timeFilterHours) * 3600 * 1000;
        tokens = tokens.filter((t) => {
          const ts = t.pool_created_at ? new Date(t.pool_created_at).getTime() : 0;
          return ts > 0 && ts < thresholdMs;
        });
      }
    }

    // Apply sort directive (in-memory for non-filter-only queries)
    if (sortDirective && !isFilterOnly) {
      const { field, order } = sortDirective;
      tokens.sort((a, b) => {
        const va = Number(a[field] ?? 0);
        const vb = Number(b[field] ?? 0);
        return order === "DESC" ? vb - va : va - vb;
      });
    }

    // Sort: if user requested explicit sort, honor it; otherwise RRF > relevance > volume
    if (sortDirective) {
      // User-requested sort takes priority (e.g., "top gainers", "highest volume")
      const { field, order } = sortDirective;
      tokens = tokens
        .sort((a, b) => {
          const va = Number(a[field] ?? 0);
          const vb = Number(b[field] ?? 0);
          return order === "DESC" ? vb - va : va - vb;
        })
        .slice(0, 10);
    } else {
      // Default: RRF score > relevance > popularity-boosted volume
      tokens = tokens
        .sort((a, b) => {
          if (a._rrfScore && b._rrfScore) return b._rrfScore - a._rrfScore;
          const relDiff = (b.relevance || 0) - (a.relevance || 0);
          if (Math.abs(relDiff) > 0.01) return relDiff;
          const volA = Number(a.volume_24h || 0);
          const volB = Number(b.volume_24h || 0);
          const popA = Number(a.search_popularity || 0);
          const popB = Number(b.search_popularity || 0);
          const scoreA = volA + (popA * volA * 0.003);
          const scoreB = volB + (popB * volB * 0.003);
          return scoreB - scoreA;
        })
        .slice(0, 10);
    }

    const searchEngine = isFilterOnly ? "tiflash" : getSearchEngineLabel(intent, usedVector);
    const queryTimeMs = Math.round(performance.now() - start);

    // Extract trader info if present
    const traderInfo = tokens.length > 0 && tokens[0]._trader_wallet
      ? {
          wallet: tokens[0]._trader_wallet,
          total_volume: tokens[0]._trader_total_volume,
          trade_count: tokens[0]._trader_trade_count,
          unique_tokens: tokens[0]._trader_unique_tokens,
          buys: tokens[0]._trader_buys,
          sells: tokens[0]._trader_sells,
        }
      : undefined;

    const allLabels = [
      ...filters.map((f) => f.label),
      ...(dexFilter ? [`${dexExclude ? "exclude " : ""}dex: ${dexFilter}`] : []),
      ...(timeLabel ? [timeLabel] : []),
      ...(sortDirective ? [`sort: ${sortDirective.field} ${sortDirective.order}`] : []),
      ...(heuristic ? [`pattern: ${heuristic}`] : []),
    ];

    const response = {
      tokens,
      events,
      trader: traderInfo,
      search_engine: searchEngine,
      search_strategy: intent,
      query_interpreted: queryInterpreted,
      filters_applied: allLabels,
      query_time_ms: queryTimeMs,
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error("[search] Search failed, using LIKE fallback:", err);
    return likeFallback(db, q, start, queryInterpreted);
  }
}

/* ── Search Strategies ───────────────────────────────────── */

async function searchFilterOnly(
  db: DB,
  filters: SearchFilter[],
  opts?: {
    dex?: string | null;
    dexExclude?: boolean;
    timeFilterHours?: number | null;
    sortDirective?: { field: string; order: "DESC" | "ASC" } | null;
  }
) {
  // Separate SQL-safe filters from special computed ones
  const sqlFilters = filters.filter((f) => !f.field.startsWith("_"));
  const safetyFilters = filters.filter((f) => f.field.startsWith("_"));
  const { where, params } = buildFilterSQL(sqlFilters);

  // Map safety filter fields to SQL columns on token_safety (ts)
  const safetyFieldMap: Record<string, string> = {
    "_is_verified": "ts.is_verified",
    "_is_lp_burned": "ts.is_lp_burned",
    "_lp_locked": "ts.lp_locked",
    "_is_mintable": "ts.is_mintable",
    "_risk_score": "ts.risk_score",
    "_holder_count": "COALESCE(ts.holder_count, 0)",
  };
  let safetyWhere = "";
  const safetyParams: number[] = [];
  const needsSafetyJoin = safetyFilters.some((f) => safetyFieldMap[f.field]);
  for (const f of safetyFilters) {
    const col = safetyFieldMap[f.field];
    if (col) {
      safetyWhere += ` AND ${col} ${f.op} ?`;
      safetyParams.push(f.value);
    }
  }
  const allParams: (string | number)[] = [...params];
  let extraWhere = "";

  // DEX filter (include or exclude)
  if (opts?.dex) {
    if (opts.dexExclude) {
      extraWhere += " AND LOWER(p.dex) != ?";
    } else {
      extraWhere += " AND LOWER(p.dex) = ?";
    }
    allParams.push(opts.dex.toLowerCase());
  }

  // Time filter
  if (opts?.timeFilterHours && opts.timeFilterHours > 0) {
    // Positive = "created within last N hours"
    const thresholdMs = Date.now() - opts.timeFilterHours * 3600 * 1000;
    extraWhere += " AND p.pool_created_at >= ?";
    allParams.push(new Date(thresholdMs).toISOString().slice(0, 19).replace("T", " "));
  } else if (opts?.timeFilterHours && opts.timeFilterHours < 0) {
    // Negative = "older than N hours"
    const hours = Math.abs(opts.timeFilterHours);
    const thresholdMs = Date.now() - hours * 3600 * 1000;
    extraWhere += " AND p.pool_created_at < ?";
    allParams.push(new Date(thresholdMs).toISOString().slice(0, 19).replace("T", " "));
  }

  // Sort directive
  const sortCol = opts?.sortDirective?.field || "volume_24h";
  const sortOrder = opts?.sortDirective?.order || "DESC";
  // Map field names to SQL columns
  const sortMap: Record<string, string> = {
    price_change_24h: "p.price_change_24h",
    volume_24h: "p.volume_24h",
    market_cap: "p.market_cap",
    price_usd: "p.price_usd",
    liquidity_usd: "p.liquidity_usd",
    holder_count: "COALESCE(ts.holder_count, 0)",
  };
  const sqlSort = sortMap[sortCol] || `p.${sortCol}`;
  const needsSafetyJoinForSort = sortCol === "holder_count";
  const needsTsJoin = needsSafetyJoin || needsSafetyJoinForSort;

  const finalParams = [...allParams, ...safetyParams];

  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT p.address, p.token_base_symbol, p.token_quote_symbol,
            p.token_base_address, p.price_usd, p.volume_24h,
            p.price_change_24h, p.dex, p.pool_created_at,
            p.txns_24h_buys, p.txns_24h_sells,
            p.liquidity_usd, p.market_cap,
            t.logo_url, t.name AS token_name
            ${needsTsJoin ? ", ts.holder_count, ts.is_mintable, ts.is_verified, ts.is_lp_burned, ts.lp_locked, ts.risk_score" : ""}
     FROM pools p
     LEFT JOIN tokens t ON p.token_base_address = t.address
     ${needsTsJoin ? "LEFT JOIN token_safety ts ON ts.token_address = p.token_base_address" : ""}
     WHERE 1=1 ${where} ${extraWhere} ${safetyWhere}
     ORDER BY ${sqlSort} ${sortOrder}
     LIMIT 50`,
    finalParams
  );
  return rows;
}

async function searchByAddress(
  db: DB,
  address: string
) {
  // Try pool/token address first
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

  if (rows.length > 0) return rows;

  // Not a pool/token? Check if it's a trader wallet
  const [traderRows] = await db.query<RowDataPacket[]>(
    `SELECT
       s.pool_address, s.side, s.usd_value, s.base_amount, s.timestamp, s.dex,
       p.token_base_symbol, p.token_quote_symbol, p.price_usd
     FROM swap_transactions s
     LEFT JOIN pools p ON s.pool_address = p.address
     WHERE s.trader_wallet = ?
     ORDER BY s.timestamp DESC
     LIMIT 20`,
    [address]
  );

  if (traderRows.length > 0) {
    // Aggregate trader stats and return as a special result
    const totalVol = traderRows.reduce((sum, r) => sum + Number(r.usd_value || 0), 0);
    const uniqueTokens = new Set(traderRows.map((r) => r.token_base_symbol)).size;
    const buys = traderRows.filter((r) => r.side === "buy").length;
    const sells = traderRows.filter((r) => r.side === "sell").length;

    // Get the most-traded token pools for this wallet
    const tokenCounts = new Map<string, { count: number; pool: string; symbol: string }>();
    for (const r of traderRows) {
      const sym = r.token_base_symbol || "?";
      const existing = tokenCounts.get(sym);
      if (!existing || existing.count < (existing.count + 1)) {
        tokenCounts.set(sym, {
          count: (existing?.count || 0) + 1,
          pool: r.pool_address,
          symbol: sym,
        });
      }
    }

    // Look up pools for the trader's most-traded tokens
    const topSymbols = Array.from(tokenCounts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    const poolAddrs = topSymbols.map((s) => s.pool);
    if (poolAddrs.length > 0) {
      const ph = poolAddrs.map(() => "?").join(",");
      const [poolRows] = await db.query<RowDataPacket[]>(
        `SELECT p.address, p.token_base_symbol, p.token_quote_symbol,
                p.token_base_address, p.price_usd, p.volume_24h,
                p.price_change_24h, p.dex, p.pool_created_at,
                p.txns_24h_buys, p.txns_24h_sells,
                p.liquidity_usd, p.market_cap,
                t.logo_url, t.name AS token_name
         FROM pools p
         LEFT JOIN tokens t ON p.token_base_address = t.address
         WHERE p.address IN (${ph})
         ORDER BY p.volume_24h DESC`,
        poolAddrs
      );
      // Tag results with trader context
      return poolRows.map((r) => ({
        ...r,
        _trader_wallet: address,
        _trader_total_volume: totalVol,
        _trader_trade_count: traderRows.length,
        _trader_unique_tokens: uniqueTokens,
        _trader_buys: buys,
        _trader_sells: sells,
      }));
    }
  }

  return rows;
}

/**
 * Look up pools by a list of token base addresses (used for fuzzy match results).
 */
async function searchByTokenAddresses(
  db: DB,
  addresses: string[]
) {
  if (addresses.length === 0) return [];
  const unique = Array.from(new Set(addresses));
  const ph = unique.map(() => "?").join(",");
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT p.address, p.token_base_symbol, p.token_quote_symbol,
            p.token_base_address, p.price_usd, p.volume_24h,
            p.price_change_24h, p.dex, p.pool_created_at,
            p.txns_24h_buys, p.txns_24h_sells,
            p.liquidity_usd, p.market_cap,
            t.logo_url, t.name AS token_name
     FROM pools p
     LEFT JOIN tokens t ON p.token_base_address = t.address
     WHERE p.token_base_address IN (${ph})
     ORDER BY p.volume_24h DESC
     LIMIT 20`,
    unique
  );
  return rows;
}

async function searchExactSymbol(
  db: DB,
  symbol: string
) {
  // Handle pair notation: "JUP/USDC" → search for "JUP"
  const term = symbol.includes("/") ? symbol.split("/")[0] : symbol;
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT p.address, p.token_base_symbol, p.token_quote_symbol,
            p.token_base_address, p.price_usd, p.volume_24h,
            p.price_change_24h, p.dex, p.pool_created_at,
            p.txns_24h_buys, p.txns_24h_sells,
            p.liquidity_usd, p.market_cap,
            t.logo_url, t.name AS token_name
     FROM pools p
     LEFT JOIN tokens t ON p.token_base_address = t.address
     WHERE LOWER(p.token_base_symbol) = LOWER(?)
     ORDER BY p.volume_24h DESC
     LIMIT 10`,
    [term]
  );
  return rows;
}

async function searchPrefix(
  db: DB,
  prefix: string
) {
  const like = `${prefix.toLowerCase()}%`;
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT p.address, p.token_base_symbol, p.token_quote_symbol,
            p.token_base_address, p.price_usd, p.volume_24h,
            p.price_change_24h, p.dex, p.pool_created_at,
            p.txns_24h_buys, p.txns_24h_sells,
            p.liquidity_usd, p.market_cap,
            t.logo_url, t.name AS token_name
     FROM pools p
     LEFT JOIN tokens t ON p.token_base_address = t.address
     WHERE LOWER(p.token_base_symbol) LIKE ?
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

  const [safetyRows, whaleRows, popRows, statsRows] = await Promise.all([
    db
      .query<RowDataPacket[]>(
        `SELECT token_address, holder_count, top10_holder_pct,
                is_mintable, is_freezable, is_verified, is_lp_burned, lp_locked, risk_score
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
    // Fetch search_popularity for ranking boost
    db.query<RowDataPacket[]>(
      `SELECT address, search_popularity
       FROM tokens
       WHERE address IN (${tPlaceholders})`,
      tokenAddresses
    ).catch(() => [[] as RowDataPacket[]]),
    // Fetch pool stats (txn counts, unique traders)
    poolAddresses.length > 0
      ? db.query<RowDataPacket[]>(
          `SELECT pool_address, txn_count_24h, unique_traders_24h, buy_sell_ratio
           FROM pool_stats_live
           WHERE pool_address IN (${pPlaceholders})`,
          poolAddresses
        ).catch(() => [[] as RowDataPacket[]])
      : Promise.resolve([[] as RowDataPacket[]]),
  ]);

  const safetyMap = new Map<string, Record<string, any>>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  const safetyData = (safetyRows as RowDataPacket[])[0] ?? safetyRows ?? [];
  const safetyList = Array.isArray(safetyData) ? safetyData : [];
  for (const s of safetyList) {
    safetyMap.set(s.token_address, {
      holder_count: s.holder_count ?? 0,
      top10_holder_pct: Number(s.top10_holder_pct) || 0,
      is_mintable: s.is_mintable ?? 1,
      is_freezable: s.is_freezable ?? 1,
      is_verified: s.is_verified ?? 0,
      is_lp_burned: s.is_lp_burned ?? 0,
      lp_locked: s.lp_locked ?? 0,
      risk_score: s.risk_score ?? 0,
    });
  }

  const whaleMap = new Map<string, number>();
  const whaleData = (whaleRows as RowDataPacket[])[0] ?? whaleRows ?? [];
  const whaleList = Array.isArray(whaleData) ? whaleData : [];
  for (const w of whaleList) {
    whaleMap.set(w.pool_address, Number(w.whale_count));
  }

  // Build popularity map
  const popMap = new Map<string, number>();
  const popData = (popRows as RowDataPacket[])[0] ?? popRows ?? [];
  const popList = Array.isArray(popData) ? popData : [];
  for (const p of popList) {
    popMap.set(p.address, Number(p.search_popularity) || 0);
  }

  // Build pool stats map
  const statsMap = new Map<string, Record<string, any>>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  const statsData = (statsRows as RowDataPacket[])[0] ?? statsRows ?? [];
  const statsList = Array.isArray(statsData) ? statsData : [];
  for (const st of statsList) {
    statsMap.set(st.pool_address, {
      txn_count_24h: Number(st.txn_count_24h) || 0,
      unique_traders_24h: Number(st.unique_traders_24h) || 0,
      buy_sell_ratio: Number(st.buy_sell_ratio) || 1,
    });
  }

  for (const row of tokens) {
    const addr = row.token_base_address || row.token_address;
    const safety = safetyMap.get(addr);
    row.holder_count = safety?.holder_count ?? null;
    row.top10_holder_pct = safety?.top10_holder_pct ?? null;
    row.is_mintable = safety?.is_mintable ?? null;
    row.is_freezable = safety?.is_freezable ?? null;
    row.is_verified = safety?.is_verified ?? 0;
    row.is_lp_burned = safety?.is_lp_burned ?? 0;
    row.lp_locked = safety?.lp_locked ?? 0;
    row.risk_score = safety?.risk_score ?? 0;
    row.txns_24h =
      (Number(row.txns_24h_buys) || 0) + (Number(row.txns_24h_sells) || 0);
    row.whale_events_24h = whaleMap.get(row.address) ?? 0;
    row.search_popularity = popMap.get(addr) ?? 0;
    // Pool stats
    const poolStats = statsMap.get(row.address);
    row.unique_traders_24h = poolStats?.unique_traders_24h ?? 0;
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
