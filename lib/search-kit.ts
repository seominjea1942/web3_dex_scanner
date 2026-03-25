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
