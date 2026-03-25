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
]);

// Base58 character set (Solana addresses)
const BASE58_RE = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{32,44}$/;

export function classifyQuery(query: string): QueryIntent {
  const trimmed = query.trim();

  // Address: base58, 32-44 chars
  if (BASE58_RE.test(trimmed)) {
    return "address";
  }

  const words = trimmed.toLowerCase().split(/\s+/).filter(Boolean);

  // Single short word (≤3 chars) → prefix autocomplete (could be partial symbol)
  if (words.length === 1 && trimmed.length <= 3) {
    return "prefix";
  }

  // Single uppercase word 4-10 chars → likely a full symbol
  if (words.length === 1 && trimmed === trimmed.toUpperCase() && trimmed.length <= 10) {
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
 */
export async function getQueryEmbedding(
  query: string
): Promise<number[] | null> {
  if (!process.env.OPENAI_API_KEY) return null;

  const cacheKey = query.toLowerCase().trim();

  // Check cache
  const cached = embeddingCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
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
}

export interface SearchFilter {
  field: string;             // SQL column: price_usd, price_change_24h, volume_24h, liquidity_usd, market_cap
  op: ">=" | "<=" | ">" | "<" | "=";
  value: number;
  label: string;             // Human-readable: "price < $1"
}

// Pattern: "under $1", "below $0.01", "less than $50K"
const UNDER_PRICE_RE = /\b(?:under|below|less\s+than|cheaper\s+than|<)\s*\$?([\d,.]+)\s*(k|m|b)?\b/i;
// Pattern: "over $1", "above $100", "more than $50K", "> $1M"
const OVER_PRICE_RE = /\b(?:over|above|more\s+than|greater\s+than|>)\s*\$?([\d,.]+)\s*(k|m|b)?\b/i;
// Pattern: "up 30%", "gained 50%", "+20%"
const UP_PCT_RE = /\b(?:up|gained|gaining|pumping|pumped|\+)\s*([\d.]+)\s*%/i;
// Pattern: "down 30%", "dropped 50%", "-20%"
const DOWN_PCT_RE = /\b(?:down|dropped|dropping|dumping|dumped|-)\s*([\d.]+)\s*%/i;
// Pattern: "volume > $50K", "vol over $1M"
const VOLUME_RE = /\b(?:vol(?:ume)?)\s*(?:>|over|above)?\s*\$?([\d,.]+)\s*(k|m|b)?\b/i;
// Pattern: "liquidity > $50K", "liq over $100K"
const LIQUIDITY_RE = /\b(?:liq(?:uidity)?)\s*(?:>|over|above)?\s*\$?([\d,.]+)\s*(k|m|b)?\b/i;
// Pattern: "mcap > $1M", "market cap over $10M"
const MCAP_RE = /\b(?:mcap|market\s*cap)\s*(?:>|over|above)?\s*\$?([\d,.]+)\s*(k|m|b)?\b/i;

function parseMultiplier(suffix: string | undefined): number {
  if (!suffix) return 1;
  switch (suffix.toLowerCase()) {
    case "k": return 1_000;
    case "m": return 1_000_000;
    case "b": return 1_000_000_000;
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

  // Extract volume BEFORE price (so "volume over $10K" doesn't match as price)
  const volMatch = text.match(VOLUME_RE);
  if (volMatch) {
    const val = parseNum(volMatch[1], volMatch[2]);
    filters.push({ field: "volume_24h", op: ">=", value: val, label: `vol ≥ $${volMatch[1]}${volMatch[2] || ""}` });
    text = text.replace(VOLUME_RE, " ");
  }

  // Extract liquidity BEFORE price
  const liqMatch = text.match(LIQUIDITY_RE);
  if (liqMatch) {
    const val = parseNum(liqMatch[1], liqMatch[2]);
    filters.push({ field: "liquidity_usd", op: ">=", value: val, label: `liq ≥ $${liqMatch[1]}${liqMatch[2] || ""}` });
    text = text.replace(LIQUIDITY_RE, " ");
  }

  // Extract market cap BEFORE price
  const mcapMatch = text.match(MCAP_RE);
  if (mcapMatch) {
    const val = parseNum(mcapMatch[1], mcapMatch[2]);
    filters.push({ field: "market_cap", op: ">=", value: val, label: `mcap ≥ $${mcapMatch[1]}${mcapMatch[2] || ""}` });
    text = text.replace(MCAP_RE, " ");
  }

  // Extract price < X (after volume/liq/mcap to avoid conflicts)
  const underMatch = text.match(UNDER_PRICE_RE);
  if (underMatch) {
    const val = parseNum(underMatch[1], underMatch[2]);
    filters.push({ field: "price_usd", op: "<=", value: val, label: `price ≤ $${underMatch[1]}${underMatch[2] || ""}` });
    text = text.replace(UNDER_PRICE_RE, " ");
  }

  // Extract price > X
  const overMatch = text.match(OVER_PRICE_RE);
  if (overMatch) {
    const val = parseNum(overMatch[1], overMatch[2]);
    filters.push({ field: "price_usd", op: ">=", value: val, label: `price ≥ $${overMatch[1]}${overMatch[2] || ""}` });
    text = text.replace(OVER_PRICE_RE, " ");
  }

  // Extract % up
  const upMatch = text.match(UP_PCT_RE);
  if (upMatch) {
    const val = parseFloat(upMatch[1]);
    filters.push({ field: "price_change_24h", op: ">=", value: val, label: `24h ≥ +${val}%` });
    text = text.replace(UP_PCT_RE, " ");
  }

  // Extract % down
  const downMatch = text.match(DOWN_PCT_RE);
  if (downMatch) {
    const val = parseFloat(downMatch[1]);
    filters.push({ field: "price_change_24h", op: "<=", value: -val, label: `24h ≤ -${val}%` });
    text = text.replace(DOWN_PCT_RE, " ");
  }

  // Clean up remaining text
  const searchText = text.replace(/\s+/g, " ").trim();

  return { searchText, filters };
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
