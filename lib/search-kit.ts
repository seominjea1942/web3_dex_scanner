/**
 * Search Kit — query classification, RRF merge, embedding cache
 */
import OpenAI from "openai";

/* ── Query Intent Classification ────────────────────────── */

export type QueryIntent =
  | "address"
  | "exact_symbol"
  | "prefix"
  | "fts"
  | "semantic"
  | "hybrid";

const SEMANTIC_TRIGGERS = new Set([
  "similar", "like", "related", "category", "type",
  "meme", "memes", "dog", "cat", "ai", "gaming", "defi",
  "nft", "metaverse", "social", "infrastructure",
  "rwa", "depin", "celebrity", "food", "anime", "frog",
]);

/* ── Known DEX names ─────────────────────────────────────── */
const KNOWN_DEXES = new Set([
  "raydium", "orca", "meteora", "jupiter", "lifinity",
  "openbook", "serum", "aldrin", "saber", "marinade",
  "phoenix", "launchlab",
]);

/* ── Trending / Sort trigger words ────────────────────────── */
const SORT_TRIGGERS: Record<string, { field: string; order: "DESC" | "ASC" }> = {
  "top gainers": { field: "price_change_24h", order: "DESC" },
  "biggest gainers": { field: "price_change_24h", order: "DESC" },
  "top losers": { field: "price_change_24h", order: "ASC" },
  "biggest losers": { field: "price_change_24h", order: "ASC" },
  "highest volume": { field: "volume_24h", order: "DESC" },
  "top volume": { field: "volume_24h", order: "DESC" },
  "most traded": { field: "volume_24h", order: "DESC" },
  "lowest mcap": { field: "market_cap", order: "ASC" },
  "lowest market cap": { field: "market_cap", order: "ASC" },
  "highest mcap": { field: "market_cap", order: "DESC" },
  "most holders": { field: "holder_count", order: "DESC" },
  "cheapest": { field: "price_usd", order: "ASC" },
  "trending": { field: "volume_24h", order: "DESC" },
  "hot": { field: "volume_24h", order: "DESC" },
  "what's hot": { field: "volume_24h", order: "DESC" },
  "whats hot": { field: "volume_24h", order: "DESC" },
  "pumping": { field: "price_change_24h", order: "DESC" },
  "dumping": { field: "price_change_24h", order: "ASC" },
};

// Base58 character set (Solana addresses)
const BASE58_RE = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{32,44}$/;

export function classifyQuery(query: string): QueryIntent {
  const trimmed = query.trim();

  // Address: base58, 32-44 chars
  if (BASE58_RE.test(trimmed)) {
    return "address";
  }

  // Pair notation: "JUP/USDC" → treat as exact_symbol for the base token
  if (/^[A-Za-z]+\/[A-Za-z]+$/.test(trimmed)) {
    return "exact_symbol";
  }

  const words = trimmed.toLowerCase().split(/\s+/).filter(Boolean);

  // Single short word (≤3 chars) → prefix autocomplete (could be partial symbol)
  if (words.length === 1 && trimmed.length <= 3) {
    return "prefix";
  }

  // Single word 4-10 chars → likely a full symbol (case-insensitive for fuzzy)
  if (words.length === 1 && /^[A-Za-z]{4,10}$/.test(trimmed)) {
    return "exact_symbol";
  }

  // Check for semantic trigger words
  const hasSemanticTrigger = words.some((w) => SEMANTIC_TRIGGERS.has(w));

  // Multi-word with semantic trigger → hybrid or semantic
  if (hasSemanticTrigger && words.length >= 2) {
    return "hybrid";
  }

  // Single semantic keyword → semantic
  if (hasSemanticTrigger && words.length === 1) {
    return "semantic";
  }

  // Default: FTS (with vector fallback if 0 results, handled in route)
  return "fts";
}

/* ── Reciprocal Rank Fusion ─────────────────────────────── */

export interface RankedResult {
  key: string; // unique identifier (token address)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>;
}

export interface MergedResult {
  key: string;
  rrfScore: number;
  sources: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>;
}

/**
 * Reciprocal Rank Fusion: score = sum(1 / (k + rank_i)) for each list
 * @param lists - Named lists of ranked results: { name: string, results: RankedResult[] }[]
 * @param k - Smoothing constant (default 60)
 */
export function rrfMerge(
  lists: { name: string; results: RankedResult[] }[],
  k = 60
): MergedResult[] {
  const scores = new Map<string, { score: number; sources: string[]; data: Record<string, any> }>(); // eslint-disable-line @typescript-eslint/no-explicit-any

  for (const { name, results } of lists) {
    for (let rank = 0; rank < results.length; rank++) {
      const { key, data } = results[rank];
      const existing = scores.get(key);
      const rrfScore = 1 / (k + rank + 1);

      if (existing) {
        existing.score += rrfScore;
        existing.sources.push(name);
        // Merge data, prefer existing
        existing.data = { ...data, ...existing.data };
      } else {
        scores.set(key, {
          score: rrfScore,
          sources: [name],
          data,
        });
      }
    }
  }

  return Array.from(scores.entries())
    .map(([key, { score, sources, data }]) => ({
      key,
      rrfScore: score,
      sources,
      data,
    }))
    .sort((a, b) => b.rrfScore - a.rrfScore);
}

/* ── Embedding Cache + Helper ───────────────────────────── */

const EMBED_MODEL = "text-embedding-3-small";
const CACHE_MAX = 1000;
const CACHE_TTL_MS = 3600_000; // 1 hour

interface CacheEntry {
  embedding: number[];
  ts: number;
}

const embeddingCache = new Map<string, CacheEntry>();

// Per-request embed timing — set by getQueryEmbedding, read by the route handler
let _lastEmbedTimeMs = 0;
let _lastEmbedFromCache = false;
export function getLastEmbedTiming() {
  return { timeMs: _lastEmbedTimeMs, fromCache: _lastEmbedFromCache };
}

let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

/**
 * Get embedding for a query string, with LRU cache.
 * Returns null if OPENAI_API_KEY is not set.
 * Side-effect: updates _lastEmbedTimeMs / _lastEmbedFromCache for the route handler.
 */
export async function getQueryEmbedding(
  query: string
): Promise<number[] | null> {
  if (!process.env.OPENAI_API_KEY) return null;

  const cacheKey = query.toLowerCase().trim();
  const t0 = performance.now();

  // Check cache
  const cached = embeddingCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    _lastEmbedTimeMs = Math.round(performance.now() - t0);
    _lastEmbedFromCache = true;
    return cached.embedding;
  }

  try {
    const openai = getOpenAI();
    const response = await openai.embeddings.create({
      model: EMBED_MODEL,
      input: cacheKey,
      dimensions: 1536,
    });

    const embedding = response.data[0].embedding;
    _lastEmbedTimeMs = Math.round(performance.now() - t0);
    _lastEmbedFromCache = false;

    // Evict oldest if at capacity
    if (embeddingCache.size >= CACHE_MAX) {
      const oldest = embeddingCache.keys().next().value;
      if (oldest !== undefined) embeddingCache.delete(oldest);
    }

    embeddingCache.set(cacheKey, { embedding, ts: Date.now() });
    return embedding;
  } catch (err) {
    console.error("[search-kit] Embedding API error:", err);
    return null;
  }
}

/* ── Natural Language Filter Extraction ──────────────────── */

export interface ParsedQuery {
  searchText: string;        // The text part to search (without filter expressions)
  filters: SearchFilter[];   // Extracted numeric filters
  dex: string | null;        // Extracted DEX name (e.g., "raydium")
  dexExclude: boolean;       // true for "not on jupiter" → exclude this DEX
  sortDirective: { field: string; order: "DESC" | "ASC" } | null; // e.g., "top gainers"
  timeFilterHours: number | null; // e.g., 24 for "today", 1 for "last hour", -720 for "older than 30 days"
  timeLabel: string;         // Human-readable: "today", "last 1h", etc.
  heuristic: string | null;  // Matched heuristic pattern name (e.g., "breakout", "gem")
  comparison: { left: string; right: string } | null;  // "BONK vs WIF" → {left:"BONK", right:"WIF"}
}

export interface SearchFilter {
  field: string;             // SQL column: price_usd, price_change_24h, volume_24h, liquidity_usd, market_cap
  op: ">=" | "<=" | ">" | "<" | "=";
  value: number;
  label: string;             // Human-readable: "price < $1"
}

// ── Percentage patterns (must be checked BEFORE generic over/under to avoid "over 50%" → price)
// Pattern: "up 30%", "gained 50%", "+20%", "over 50%" (when followed by %)
const UP_PCT_RE = /\b(?:up|gained|gaining|pumping|pumped|over|above|\+)\s*([\d.]+)\s*%/i;
// Pattern: "down 30%", "dropped 50%", "-20%"
const DOWN_PCT_RE = /\b(?:down|dropped|dropping|dumping|dumped|-)\s*([\d.]+)\s*%/i;

// ── Volume: "volume > $50K", "vol over $1M", "over 1M volume", "volume under $10K"
const VOLUME_OVER_RE = /\b(?:vol(?:ume)?)\s*(?:>|over|above)\s*\$?([\d,.]+)\s*(k|m|b)?\b/i;
const VOLUME_OVER_REVERSE_RE = /\b(?:over|above|more\s+than|>)\s*\$?([\d,.]+)\s*(k|m|b)?\s+(?:vol(?:ume)?|trading\s+vol(?:ume)?)\b/i; // "over 1M volume"
const VOLUME_UNDER_RE = /\b(?:vol(?:ume)?)\s*(?:<|under|below)\s*\$?([\d,.]+)\s*(k|m|b)?\b/i;
const VOLUME_UNDER_REVERSE_RE = /\b(?:under|below|less\s+than|<)\s*\$?([\d,.]+)\s*(k|m|b)?\s+(?:vol(?:ume)?)\b/i; // "under 10K volume"
const VOLUME_BARE_RE = /\b(?:vol(?:ume)?)\s+\$?([\d,.]+)\s*(k|m|b)?\b/i; // "volume 1M" (no operator, assume >=)

// ── Liquidity: "liquidity > $50K", "liq under $100K", "over $50K liquidity"
const LIQ_OVER_RE = /\b(?:liq(?:uidity)?)\s*(?:>|over|above)\s*\$?([\d,.]+)\s*(k|m|b)?\b/i;
const LIQ_OVER_REVERSE_RE = /\b(?:over|above|more\s+than|>)\s*\$?([\d,.]+)\s*(k|m|b)?\s+(?:liq(?:uidity)?)\b/i; // "over 500K liquidity"
const LIQ_UNDER_RE = /\b(?:liq(?:uidity)?)\s*(?:<|under|below)\s*\$?([\d,.]+)\s*(k|m|b)?\b/i;

// ── Market cap: "mcap > $1M", "mcap under 100k", "market cap below $500K"
const MCAP_OVER_RE = /\b(?:mcap|market\s*cap)\s*(?:>|over|above)\s*\$?([\d,.]+)\s*(k|m|b)?\b/i;
const MCAP_UNDER_RE = /\b(?:mcap|market\s*cap)\s*(?:<|under|below)\s*\$?([\d,.]+)\s*(k|m|b)?\b/i;
const MCAP_BARE_RE = /\b(?:mcap|market\s*cap)\s+\$?([\d,.]+)\s*(k|m|b)?\b/i; // "mcap 100k" (assume >=)

// ── Price: "under $1", "below $0.01", "over $100", "sub penny" (fallback — checked LAST)
const UNDER_PRICE_RE = /\b(?:under|below|less\s+than|cheaper\s+than|<)\s*\$?([\d,.]+)\s*(k|m|b|cent|cents|penny)?\b/i;
const OVER_PRICE_RE = /\b(?:over|above|more\s+than|greater\s+than|>)\s*\$?([\d,.]+)\s*(k|m|b)?\b/i;
const SUB_PENNY_RE = /\bsub[\s-]?penn(?:y|ies)\b/i;

// ── Range filter: "between $1 and $5"
const BETWEEN_PRICE_RE = /\bbetween\s*\$?([\d,.]+)\s*(k|m|b)?\s*and\s*\$?([\d,.]+)\s*(k|m|b)?\b/i;

// ── Transaction count: "over 1000 transactions", "more than 500 txns"
const TXN_COUNT_RE = /\b(?:over|above|more\s+than|>)\s*([\d,.]+)\s*(?:transactions?|txns?|trades?)\b/i;

// ── Buy/sell ratio: "buy sell ratio bullish", "more buys than sells"
const BULLISH_RATIO_RE = /\b(?:buy\s*(?:\/|sell)?\s*ratio\s*(?:bullish|high|strong)|more\s+buys?\s+than\s+sells?)\b/i;
const BEARISH_RATIO_RE = /\b(?:buy\s*(?:\/|sell)?\s*ratio\s*(?:bearish|low|weak)|more\s+sells?\s+than\s+buys?)\b/i;

// ── Mcap/Volume ratio: "mcap to volume ratio under 5"
const MCAP_VOL_RATIO_RE = /\b(?:mcap|market\s*cap)\s*(?:to|\/)\s*(?:vol(?:ume)?)\s*ratio\s*(?:under|below|<)\s*([\d.]+)\b/i;

// ── DEX exclusion: "not on jupiter", "exclude raydium"
const DEX_EXCLUDE_RE = /\b(?:not\s+on|exclude|without|except)\s+(\w+)\b/i;

// ── Safety filters
const VERIFIED_RE = /\b(?:verified\s+(?:tokens?\s+)?only|verified\s+tokens?|only\s+verified)\b/i;
const BURNED_LP_RE = /\b(?:burned?\s+(?:lp|liquidity)|lp\s+burned?)\b/i;
const LOCKED_LP_RE = /\b(?:locked?\s+(?:lp|liquidity)|lp\s+locked?)\b/i;
const NO_MINT_RE = /\b(?:no\s+mint(?:\s+authority)?|mint\s+(?:authority\s+)?(?:revoked|renounced|disabled))\b/i;
const SAFE_TOKEN_RE = /\b(?:safe|low\s+risk|safe(?:r|st))\b/i;
const AUDIT_RE = /\b(?:with\s+audit|audited|audit(?:ed)?\s+tokens?)\b/i;
const RUG_RE = /\b(?:rug\s+(?:pull\s+)?risk\s+low|low\s+rug|anti[\s-]?rug)\b/i;

// ── "vs" comparison: "BONK vs WIF", "raydium vs orca"
const VS_RE = /^(.+?)\s+vs\.?\s+(.+)$/i;

// ── Holder/buyer patterns
const GROWING_HOLDERS_RE = /\b(?:growing\s+holders?|holder\s+growth|increasing\s+holders?)\b/i;
const UNIQUE_BUYERS_RE = /\b(?:unique\s+(?:buyers?|traders?)|distinct\s+(?:buyers?|traders?))\b/i;
const INSIDER_RE = /\b(?:insider|smart\s+money\s+(?:buying|accumulating)|insider\s+wallets?)\b/i;

// ── Sector/category
const SECTOR_RE = /\b(?:sector|category|categories|sectors?)\b/i;

// ── Heuristic pattern triggers (LLM-free alternatives for complex intents)
interface HeuristicRule {
  filters: SearchFilter[];
  sort?: { field: string; order: "DESC" | "ASC" };
}

const HEURISTIC_TRIGGERS: Record<string, HeuristicRule> = {
  "recovering from dip": {
    filters: [
      { field: "price_change_24h", op: ">=", value: 5, label: "24h ≥ +5% (recovering)" },
    ],
    sort: { field: "price_change_24h", order: "DESC" },
  },
  "recovery": {
    filters: [
      { field: "price_change_24h", op: ">=", value: 5, label: "24h ≥ +5% (recovering)" },
    ],
    sort: { field: "price_change_24h", order: "DESC" },
  },
  "bouncing back": {
    filters: [
      { field: "price_change_24h", op: ">=", value: 5, label: "24h ≥ +5% (bouncing)" },
    ],
    sort: { field: "price_change_24h", order: "DESC" },
  },
  "breakout": {
    filters: [
      { field: "price_change_24h", op: ">=", value: 20, label: "24h ≥ +20% (breakout)" },
    ],
    sort: { field: "price_change_24h", order: "DESC" },
  },
  "breaking out": {
    filters: [
      { field: "price_change_24h", op: ">=", value: 20, label: "24h ≥ +20% (breakout)" },
    ],
    sort: { field: "price_change_24h", order: "DESC" },
  },
  "100x": {
    filters: [
      { field: "market_cap", op: "<=", value: 100_000, label: "mcap ≤ $100K (gem)" },
      { field: "volume_24h", op: ">=", value: 5_000, label: "vol ≥ $5K (active)" },
    ],
    sort: { field: "volume_24h", order: "DESC" },
  },
  "gem": {
    filters: [
      { field: "market_cap", op: "<=", value: 2_000_000, label: "mcap ≤ $2M (gem)" },
    ],
    sort: { field: "volume_24h", order: "DESC" },
  },
  "low liquidity": {
    filters: [
      { field: "liquidity_usd", op: "<=", value: 10_000, label: "liq ≤ $10K (low)" },
    ],
    sort: { field: "volume_24h", order: "DESC" },
  },
  "micro cap": {
    filters: [
      { field: "market_cap", op: "<=", value: 100_000, label: "mcap ≤ $100K (micro)" },
    ],
    sort: { field: "volume_24h", order: "DESC" },
  },
  "moonshot": {
    filters: [
      { field: "market_cap", op: "<=", value: 200_000, label: "mcap ≤ $200K (moonshot)" },
    ],
    sort: { field: "price_change_24h", order: "DESC" },
  },
  "all time high": {
    filters: [
      { field: "price_change_24h", op: ">=", value: 30, label: "24h ≥ +30% (ATH candidate)" },
    ],
    sort: { field: "price_change_24h", order: "DESC" },
  },
  "new all time high": {
    filters: [
      { field: "price_change_24h", op: ">=", value: 30, label: "24h ≥ +30% (ATH candidate)" },
    ],
    sort: { field: "price_change_24h", order: "DESC" },
  },
  "steady uptrend": {
    filters: [
      { field: "price_change_24h", op: ">=", value: 5, label: "24h ≥ +5% (uptrend)" },
    ],
    sort: { field: "price_change_24h", order: "DESC" },
  },
  "uptrend": {
    filters: [
      { field: "price_change_24h", op: ">=", value: 5, label: "24h ≥ +5% (uptrend)" },
    ],
    sort: { field: "price_change_24h", order: "DESC" },
  },
  "volume spike": {
    filters: [
      { field: "volume_24h", op: ">=", value: 50_000, label: "vol ≥ $50K (spike)" },
    ],
    sort: { field: "volume_24h", order: "DESC" },
  },
  "dead volume": {
    filters: [
      { field: "volume_24h", op: "<=", value: 100, label: "vol ≤ $100 (dead)" },
    ],
    sort: { field: "volume_24h", order: "ASC" },
  },
  "no volume": {
    filters: [
      { field: "volume_24h", op: "<=", value: 10, label: "vol ≤ $10 (no volume)" },
    ],
    sort: { field: "volume_24h", order: "ASC" },
  },
};

// ── Time/age: "last hour", "today", "this week", "new", "launched today"
const TIME_FILTERS: { re: RegExp; hours: number; label: string }[] = [
  { re: /\b(?:last|past)\s*(\d+)\s*min(?:ute)?s?\b/i, hours: -1, label: "" }, // special: use group
  { re: /\b(?:last|past)\s*(\d+)\s*hours?\b/i, hours: -1, label: "" },       // special: use group
  { re: /\b(?:last|past)\s*5\s*min/i, hours: 5 / 60, label: "last 5m" },
  { re: /\b(?:last|past)\s*(?:1\s*)?hour\b/i, hours: 1, label: "last 1h" },
  { re: /\b(?:launched|created|listed|new)\s*today\b/i, hours: 24, label: "today" },
  { re: /\btoday\b/i, hours: 24, label: "today" },
  { re: /\b(?:this|last|past)\s*week\b/i, hours: 168, label: "this week" },
  { re: /\b(?:last|past)\s*24\s*h(?:ours?)?\b/i, hours: 24, label: "24h" },
  { re: /\bnew(?:est|ly)?\s+(?:tokens?|pairs?|pools?|launches?|listed)\b/i, hours: 24, label: "new (24h)" },
  { re: /\b(?:just|recently)\s+(?:launched|listed|created)\b/i, hours: 1, label: "just launched" },
  { re: /\b(?:fresh)\s+(?:pools?|pairs?|tokens?)\b/i, hours: 6, label: "fresh (6h)" },
  { re: /\bolder\s+than\s+(\d+)\s*days?\b/i, hours: -2, label: "" }, // special: negative = older than
];

function parseMultiplier(suffix: string | undefined): number {
  if (!suffix) return 1;
  switch (suffix.toLowerCase()) {
    case "k": return 1_000;
    case "m": return 1_000_000;
    case "b": return 1_000_000_000;
    case "cent": case "cents": return 0.01;
    case "penny": return 0.01;
    default: return 1;
  }
}

function parseNum(raw: string, suffix?: string): number {
  const n = parseFloat(raw.replace(/,/g, ""));
  return n * parseMultiplier(suffix);
}

export function parseQueryFilters(query: string): ParsedQuery {
  const filters: SearchFilter[] = [];
  let text = query;
  let dex: string | null = null;
  let dexExclude = false;
  let sortDirective: { field: string; order: "DESC" | "ASC" } | null = null;
  let timeFilterHours: number | null = null;
  let timeLabel = "";
  let heuristic: string | null = null;
  let comparison: { left: string; right: string } | null = null;

  // ── -2. Check "vs" comparison FIRST ──
  const vsMatch = query.match(VS_RE);
  if (vsMatch) {
    comparison = { left: vsMatch[1].trim(), right: vsMatch[2].trim() };
    // Don't extract further — return both parts as search
    return {
      searchText: query, filters: [], dex: null, dexExclude: false,
      sortDirective: null, timeFilterHours: null, timeLabel: "",
      heuristic: null, comparison,
    };
  }

  // ── -1. Check DEX exclusion FIRST ("not on jupiter", "exclude raydium") ──
  const excludeMatch = text.match(DEX_EXCLUDE_RE);
  if (excludeMatch) {
    const excludeName = excludeMatch[1].toLowerCase();
    if (KNOWN_DEXES.has(excludeName)) {
      dex = excludeName;
      dexExclude = true;
      text = text.replace(DEX_EXCLUDE_RE, " ");
    }
  }

  // ── 0. Extract DEX name (only if not already set by exclusion) ──
  if (!dex) {
    // Check if DEX name is also a token name — if so, keep it for search
    const AMBIGUOUS_DEX_TOKENS = new Set(["jupiter", "orca", "raydium"]);
    const lowerText = text.toLowerCase();
    for (const dexName of Array.from(KNOWN_DEXES)) {
      if (lowerText.includes(dexName)) {
        // "jupiter token" → ambiguous; search for jupiter as token too
        const hasTokenWord = /\b(?:token|coin|price)\b/i.test(text);
        if (AMBIGUOUS_DEX_TOKENS.has(dexName) && hasTokenWord) {
          // Don't extract as DEX filter — let it remain as search text
          break;
        }
        dex = dexName;
        text = text.replace(new RegExp(`\\b${dexName}\\b`, "gi"), " ");
        break;
      }
    }
  }

  // ── 0b. Extract sort directives (check multi-word first) ──
  const lowerText2 = text.toLowerCase();
  for (const [trigger, directive] of Object.entries(SORT_TRIGGERS).sort((a, b) => b[0].length - a[0].length)) {
    if (lowerText2.includes(trigger)) {
      sortDirective = directive;
      text = text.replace(new RegExp(trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "gi"), " ");
      break;
    }
  }

  // ── 0c. Extract time/age filter ──
  for (const tf of TIME_FILTERS) {
    const m = text.match(tf.re);
    if (m) {
      if (tf.hours === -1 && m[1]) {
        // Dynamic: "last N minutes/hours"
        const n = parseInt(m[1], 10);
        timeFilterHours = tf.re.source.includes("min") ? n / 60 : n;
        timeLabel = `last ${m[1]}${tf.re.source.includes("min") ? "m" : "h"}`;
      } else if (tf.hours === -2 && m[1]) {
        // "older than N days" — negative means we want pool_created_at < threshold
        timeFilterHours = -(parseInt(m[1], 10) * 24);
        timeLabel = `older than ${m[1]}d`;
      } else {
        timeFilterHours = tf.hours;
        timeLabel = tf.label;
      }
      text = text.replace(tf.re, " ");
      break;
    }
  }

  // ── 1. Extract percentage changes FIRST (before over/under which would steal "over 50%") ──
  const upMatch = text.match(UP_PCT_RE);
  if (upMatch) {
    const val = parseFloat(upMatch[1]);
    filters.push({ field: "price_change_24h", op: ">=", value: val, label: `24h ≥ +${val}%` });
    text = text.replace(UP_PCT_RE, " ");
  }

  const downMatch = text.match(DOWN_PCT_RE);
  if (downMatch) {
    const val = parseFloat(downMatch[1]);
    filters.push({ field: "price_change_24h", op: "<=", value: -val, label: `24h ≤ -${val}%` });
    text = text.replace(DOWN_PCT_RE, " ");
  }

  // ── 2. Volume (before generic price) — check BOTH "volume over X" AND "over X volume" ──
  let volMatched = false;
  const volOverMatch = text.match(VOLUME_OVER_RE);
  if (volOverMatch) {
    filters.push({ field: "volume_24h", op: ">=", value: parseNum(volOverMatch[1], volOverMatch[2]), label: `vol ≥ $${volOverMatch[1]}${volOverMatch[2] || ""}` });
    text = text.replace(VOLUME_OVER_RE, " ");
    volMatched = true;
  }
  if (!volMatched) {
    const volOverRevMatch = text.match(VOLUME_OVER_REVERSE_RE);
    if (volOverRevMatch) {
      filters.push({ field: "volume_24h", op: ">=", value: parseNum(volOverRevMatch[1], volOverRevMatch[2]), label: `vol ≥ $${volOverRevMatch[1]}${volOverRevMatch[2] || ""}` });
      text = text.replace(VOLUME_OVER_REVERSE_RE, " ");
      volMatched = true;
    }
  }
  const volUnderMatch = text.match(VOLUME_UNDER_RE);
  if (volUnderMatch) {
    filters.push({ field: "volume_24h", op: "<=", value: parseNum(volUnderMatch[1], volUnderMatch[2]), label: `vol ≤ $${volUnderMatch[1]}${volUnderMatch[2] || ""}` });
    text = text.replace(VOLUME_UNDER_RE, " ");
    volMatched = true;
  }
  if (!volMatched) {
    const volUnderRevMatch = text.match(VOLUME_UNDER_REVERSE_RE);
    if (volUnderRevMatch) {
      filters.push({ field: "volume_24h", op: "<=", value: parseNum(volUnderRevMatch[1], volUnderRevMatch[2]), label: `vol ≤ $${volUnderRevMatch[1]}${volUnderRevMatch[2] || ""}` });
      text = text.replace(VOLUME_UNDER_REVERSE_RE, " ");
      volMatched = true;
    }
  }
  if (!volMatched) {
    const volBareMatch = text.match(VOLUME_BARE_RE);
    if (volBareMatch) {
      filters.push({ field: "volume_24h", op: ">=", value: parseNum(volBareMatch[1], volBareMatch[2]), label: `vol ≥ $${volBareMatch[1]}${volBareMatch[2] || ""}` });
      text = text.replace(VOLUME_BARE_RE, " ");
    }
  }

  // ── 3. Liquidity (before generic price) — both directions ──
  let liqMatched = false;
  const liqOverMatch = text.match(LIQ_OVER_RE);
  if (liqOverMatch) {
    filters.push({ field: "liquidity_usd", op: ">=", value: parseNum(liqOverMatch[1], liqOverMatch[2]), label: `liq ≥ $${liqOverMatch[1]}${liqOverMatch[2] || ""}` });
    text = text.replace(LIQ_OVER_RE, " ");
    liqMatched = true;
  }
  if (!liqMatched) {
    const liqOverRevMatch = text.match(LIQ_OVER_REVERSE_RE);
    if (liqOverRevMatch) {
      filters.push({ field: "liquidity_usd", op: ">=", value: parseNum(liqOverRevMatch[1], liqOverRevMatch[2]), label: `liq ≥ $${liqOverRevMatch[1]}${liqOverRevMatch[2] || ""}` });
      text = text.replace(LIQ_OVER_REVERSE_RE, " ");
      liqMatched = true;
    }
  }
  const liqUnderMatch = text.match(LIQ_UNDER_RE);
  if (liqUnderMatch) {
    filters.push({ field: "liquidity_usd", op: "<=", value: parseNum(liqUnderMatch[1], liqUnderMatch[2]), label: `liq ≤ $${liqUnderMatch[1]}${liqUnderMatch[2] || ""}` });
    text = text.replace(LIQ_UNDER_RE, " ");
  }

  // ── 4. Market cap (both directions — FIX for "mcap under X") ──
  const mcapOverMatch = text.match(MCAP_OVER_RE);
  if (mcapOverMatch) {
    filters.push({ field: "market_cap", op: ">=", value: parseNum(mcapOverMatch[1], mcapOverMatch[2]), label: `mcap ≥ $${mcapOverMatch[1]}${mcapOverMatch[2] || ""}` });
    text = text.replace(MCAP_OVER_RE, " ");
  }
  const mcapUnderMatch = text.match(MCAP_UNDER_RE);
  if (mcapUnderMatch) {
    filters.push({ field: "market_cap", op: "<=", value: parseNum(mcapUnderMatch[1], mcapUnderMatch[2]), label: `mcap ≤ $${mcapUnderMatch[1]}${mcapUnderMatch[2] || ""}` });
    text = text.replace(MCAP_UNDER_RE, " ");
  }
  if (!mcapOverMatch && !mcapUnderMatch) {
    const mcapBareMatch = text.match(MCAP_BARE_RE);
    if (mcapBareMatch) {
      filters.push({ field: "market_cap", op: ">=", value: parseNum(mcapBareMatch[1], mcapBareMatch[2]), label: `mcap ≥ $${mcapBareMatch[1]}${mcapBareMatch[2] || ""}` });
      text = text.replace(MCAP_BARE_RE, " ");
    }
  }

  // ── 5. "sub penny" idiom ──
  if (SUB_PENNY_RE.test(text)) {
    filters.push({ field: "price_usd", op: "<=", value: 0.01, label: "price ≤ $0.01" });
    text = text.replace(SUB_PENNY_RE, " ");
  }

  // ── 5b. Range filter: "between $1 and $5" ──
  const betweenMatch = text.match(BETWEEN_PRICE_RE);
  if (betweenMatch) {
    const low = parseNum(betweenMatch[1], betweenMatch[2]);
    const high = parseNum(betweenMatch[3], betweenMatch[4]);
    filters.push({ field: "price_usd", op: ">=", value: Math.min(low, high), label: `price ≥ $${Math.min(low, high)}` });
    filters.push({ field: "price_usd", op: "<=", value: Math.max(low, high), label: `price ≤ $${Math.max(low, high)}` });
    text = text.replace(BETWEEN_PRICE_RE, " ");
  }

  // ── 5c. Mcap/volume ratio: "mcap to volume ratio under 5" ──
  const ratioMatch = text.match(MCAP_VOL_RATIO_RE);
  if (ratioMatch) {
    // We'll handle this as a special filter in the search route
    const val = parseFloat(ratioMatch[1]);
    filters.push({ field: "_mcap_vol_ratio", op: "<=", value: val, label: `mcap/vol ratio ≤ ${val}` });
    text = text.replace(MCAP_VOL_RATIO_RE, " ");
  }

  // ── 5d. Transaction count: "over 1000 transactions" ──
  const txnMatch = text.match(TXN_COUNT_RE);
  if (txnMatch) {
    const val = parseNum(txnMatch[1]);
    filters.push({ field: "_txn_count_24h", op: ">=", value: val, label: `txns ≥ ${val}` });
    text = text.replace(TXN_COUNT_RE, " ");
  }

  // ── 5e. Buy/sell ratio ──
  if (BULLISH_RATIO_RE.test(text)) {
    filters.push({ field: "_buy_sell_ratio", op: ">=", value: 1.5, label: "bullish ratio (buys > sells)" });
    text = text.replace(BULLISH_RATIO_RE, " ");
  } else if (BEARISH_RATIO_RE.test(text)) {
    filters.push({ field: "_buy_sell_ratio", op: "<=", value: 0.67, label: "bearish ratio (sells > buys)" });
    text = text.replace(BEARISH_RATIO_RE, " ");
  }

  // ── 6. Generic price under/over (LAST — everything else already extracted) ──
  if (!betweenMatch) {
    const underMatch = text.match(UNDER_PRICE_RE);
    if (underMatch) {
      const val = parseNum(underMatch[1], underMatch[2]);
      filters.push({ field: "price_usd", op: "<=", value: val, label: `price ≤ $${val}` });
      text = text.replace(UNDER_PRICE_RE, " ");
    }

    const overMatch = text.match(OVER_PRICE_RE);
    if (overMatch) {
      const val = parseNum(overMatch[1], overMatch[2]);
      filters.push({ field: "price_usd", op: ">=", value: val, label: `price ≥ $${val}` });
      text = text.replace(OVER_PRICE_RE, " ");
    }
  }

  // ── 7. Safety NL filters ──
  if (VERIFIED_RE.test(text)) {
    filters.push({ field: "_is_verified", op: ">=", value: 1, label: "verified only" });
    text = text.replace(VERIFIED_RE, " ");
  }
  if (BURNED_LP_RE.test(text)) {
    filters.push({ field: "_is_lp_burned", op: ">=", value: 1, label: "burned LP" });
    text = text.replace(BURNED_LP_RE, " ");
  }
  if (LOCKED_LP_RE.test(text)) {
    filters.push({ field: "_lp_locked", op: ">=", value: 1, label: "locked LP" });
    text = text.replace(LOCKED_LP_RE, " ");
  }
  if (NO_MINT_RE.test(text)) {
    filters.push({ field: "_is_mintable", op: "<=", value: 0, label: "no mint authority" });
    text = text.replace(NO_MINT_RE, " ");
  }
  if (AUDIT_RE.test(text)) {
    filters.push({ field: "_risk_score", op: ">=", value: 80, label: "audited (score ≥ 80)" });
    text = text.replace(AUDIT_RE, " ");
  }
  if (RUG_RE.test(text)) {
    filters.push({ field: "_risk_score", op: ">=", value: 50, label: "low rug risk (score ≥ 50)" });
    text = text.replace(RUG_RE, " ");
  }
  if (SAFE_TOKEN_RE.test(text) && !filters.some(f => f.field.includes("risk"))) {
    filters.push({ field: "_risk_score", op: ">=", value: 60, label: "safe (score ≥ 60)" });
    text = text.replace(SAFE_TOKEN_RE, " ");
  }

  // ── 7b. Holder/buyer patterns ──
  if (GROWING_HOLDERS_RE.test(text)) {
    filters.push({ field: "_holder_count", op: ">=", value: 50, label: "holders ≥ 50 (growing)" });
    if (!sortDirective) sortDirective = { field: "holder_count", order: "DESC" };
    text = text.replace(GROWING_HOLDERS_RE, " ");
  }
  if (UNIQUE_BUYERS_RE.test(text)) {
    filters.push({ field: "_unique_traders", op: ">=", value: 5, label: "unique traders ≥ 5" });
    text = text.replace(UNIQUE_BUYERS_RE, " ");
  }
  if (INSIDER_RE.test(text)) {
    // Map to whale/smart_money events
    filters.push({ field: "_whale_events", op: ">=", value: 1, label: "insider/smart money activity" });
    text = text.replace(INSIDER_RE, " ");
  }

  // ── 7c. Sector analytics ──
  if (SECTOR_RE.test(text)) {
    filters.push({ field: "_sector_query", op: ">=", value: 1, label: "sector analytics" });
    text = text.replace(SECTOR_RE, " ");
  }

  // ── 8. Heuristic pattern matching (check AFTER filter extraction) ──
  const cleanedLower = text.toLowerCase().trim();
  for (const [trigger, rule] of Object.entries(HEURISTIC_TRIGGERS).sort((a, b) => b[0].length - a[0].length)) {
    if (cleanedLower.includes(trigger)) {
      heuristic = trigger;
      filters.push(...rule.filters);
      if (rule.sort && !sortDirective) {
        sortDirective = rule.sort;
      }
      text = text.replace(new RegExp(trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "gi"), " ");
      break;
    }
  }

  // Clean up remaining text
  const searchText = text.replace(/\s+/g, " ").trim();

  return { searchText, filters, dex, dexExclude, sortDirective, timeFilterHours, timeLabel, heuristic, comparison };
}

/**
 * Build SQL WHERE clause fragments for parsed filters
 */
export function buildFilterSQL(filters: SearchFilter[]): { where: string; params: number[] } {
  if (filters.length === 0) return { where: "", params: [] };

  const clauses: string[] = [];
  const params: number[] = [];

  for (const f of filters) {
    clauses.push(`p.${f.field} ${f.op} ?`);
    params.push(f.value);
  }

  return {
    where: " AND " + clauses.join(" AND "),
    params,
  };
}

/* ── Result Deduplication ───────────────────────────────── */

/**
 * Deduplicate search results: keep only the highest-volume pool per unique token.
 * This prevents showing 7 BONK/SOL, BONK/USDC, etc.
 */
export function deduplicateByToken(
  tokens: Record<string, any>[] // eslint-disable-line @typescript-eslint/no-explicit-any
): Record<string, any>[] { // eslint-disable-line @typescript-eslint/no-explicit-any
  const byToken = new Map<string, Record<string, any>>(); // eslint-disable-line @typescript-eslint/no-explicit-any

  for (const t of tokens) {
    const key = t.token_base_address || t.token_address || t.address;
    if (!key) continue;

    const existing = byToken.get(key);
    if (!existing) {
      byToken.set(key, t);
    } else {
      // Keep higher volume, or higher relevance/rrfScore
      const newVol = Number(t.volume_24h || 0);
      const existVol = Number(existing.volume_24h || 0);
      const newScore = Number(t._rrfScore || t.relevance || 0);
      const existScore = Number(existing._rrfScore || existing.relevance || 0);

      if (newScore > existScore || (newScore === existScore && newVol > existVol)) {
        byToken.set(key, t);
      }
    }
  }

  return Array.from(byToken.values());
}

/* ── Fuzzy / Typo Tolerance ──────────────────────────────── */

/**
 * Levenshtein distance between two strings.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * In-memory symbol cache for fuzzy matching. Loaded once, refreshed every 5 minutes.
 */
let symbolCache: { symbol: string; address: string }[] = [];
let symbolCacheTs = 0;
const SYMBOL_CACHE_TTL = 300_000; // 5 minutes

export function setSymbolCache(symbols: { symbol: string; address: string }[]) {
  symbolCache = symbols;
  symbolCacheTs = Date.now();
}

export function isSymbolCacheStale(): boolean {
  return Date.now() - symbolCacheTs > SYMBOL_CACHE_TTL;
}

/**
 * Find symbols within edit distance threshold.
 * Returns top matches sorted by distance (best first), then by shorter symbol.
 */
export function fuzzyMatchSymbol(
  query: string,
  maxDistance = 2,
  limit = 10
): { symbol: string; address: string; distance: number }[] {
  const q = query.toUpperCase();
  const results: { symbol: string; address: string; distance: number }[] = [];

  for (const { symbol, address } of symbolCache) {
    // Quick filter: skip if length difference > maxDistance
    if (Math.abs(symbol.length - q.length) > maxDistance) continue;

    const d = levenshtein(q, symbol.toUpperCase());
    if (d <= maxDistance && d > 0) { // d > 0 excludes exact matches (handled elsewhere)
      results.push({ symbol, address, distance: d });
    }
  }

  return results
    .sort((a, b) => a.distance - b.distance || a.symbol.length - b.symbol.length)
    .slice(0, limit);
}

/* ── Auto-Embed New Tokens ─────────────────────────────── */

/**
 * Embed any tokens that have embedding IS NULL.
 * Called after sync to ensure new tokens are searchable via vector.
 * Returns count of newly embedded tokens.
 * Gracefully returns 0 if OPENAI_API_KEY is not set.
 */
export async function embedNewTokens(
  db: import("mysql2/promise").Pool
): Promise<number> {
  if (!process.env.OPENAI_API_KEY) return 0;

  try {
    const [rows] = await db.query<import("mysql2/promise").RowDataPacket[]>(
      "SELECT address, name, symbol FROM tokens WHERE embedding IS NULL LIMIT 100"
    );

    if (!Array.isArray(rows) || rows.length === 0) return 0;

    const openai = getOpenAI();
    const BATCH_SIZE = 100;
    let embedded = 0;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const inputs = batch.map((t) => {
        const sym = t.symbol || "";
        const name = t.name || "";
        return `${sym} ${name}`.trim() || t.address;
      });

      const response = await openai.embeddings.create({
        model: EMBED_MODEL,
        input: inputs,
        dimensions: 1536,
      });

      for (let j = 0; j < batch.length; j++) {
        const vecStr = `[${response.data[j].embedding.join(",")}]`;
        await db.execute(
          "UPDATE tokens SET embedding = ? WHERE address = ?",
          [vecStr, batch[j].address]
        );
        embedded++;
      }
    }

    return embedded;
  } catch (err) {
    console.warn("[search-kit] Auto-embed failed:", err);
    return 0;
  }
}

/* ── Search Engine Label ────────────────────────────────── */

export function getSearchEngineLabel(strategy: QueryIntent, usedVector: boolean): string {
  switch (strategy) {
    case "address": return "exact";
    case "exact_symbol": return "exact";
    case "prefix": return "prefix";
    case "fts": return usedVector ? "hybrid" : "fts";
    case "semantic": return "vector";
    case "hybrid": return "hybrid";
    default: return "fts";
  }
}
