/**
 * CHAINSCOPE Search API — Comprehensive Test Suite
 *
 * Usage:
 *   npx tsx scripts/test-search.ts
 *   npx tsx scripts/test-search.ts http://localhost:3099   # custom base URL
 *
 * Expects a running dev server (default http://localhost:3099).
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

/* ── Colours ────────────────────────────────────────────── */

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

/* ── Types ──────────────────────────────────────────────── */

interface SearchResponse {
  tokens: TokenResult[];
  events: unknown[];
  search_engine: string;
  search_strategy: string;
  query_interpreted?: string;
  filters_applied?: string[];
  query_time_ms?: number;
}

interface TokenResult {
  address: string;
  token_base_symbol: string;
  token_quote_symbol: string;
  token_base_address: string;
  price_usd: number | string | null;
  volume_24h: number | string | null;
  price_change_24h: number | string | null;
  dex: string;
  pool_created_at: string;
  token_name: string | null;
  logo_url: string | null;
  holder_count: number | null;
  whale_events_24h: number | null;
  txns_24h: number | null;
  liquidity_usd: number | string | null;
  market_cap: number | string | null;
  [key: string]: unknown;
}

/* ── Globals ────────────────────────────────────────────── */

const BASE_URL = process.argv[2] || "http://localhost:3099";

let totalPassed = 0;
let totalFailed = 0;
let totalSkipped = 0;
const failedTests: string[] = [];

/* ── Helpers ────────────────────────────────────────────── */

async function searchAPI(query: string): Promise<SearchResponse> {
  const url = `${BASE_URL}/api/search?q=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for query "${query}": ${await res.text()}`);
  }
  return res.json() as Promise<SearchResponse>;
}

function pass(name: string, detail?: string) {
  totalPassed++;
  const extra = detail ? ` ${DIM}(${detail})${RESET}` : "";
  console.log(`  ${GREEN}PASS${RESET} ${name}${extra}`);
}

function fail(name: string, reason: string) {
  totalFailed++;
  failedTests.push(`${name}: ${reason}`);
  console.log(`  ${RED}FAIL${RESET} ${name}`);
  console.log(`       ${RED}${reason}${RESET}`);
}

function skip(name: string, reason: string) {
  totalSkipped++;
  console.log(`  ${YELLOW}SKIP${RESET} ${name} — ${reason}`);
}

function section(title: string) {
  console.log();
  console.log(`${CYAN}${BOLD}[${ title }]${RESET}`);
}

function assert(condition: boolean, name: string, failReason: string, detail?: string) {
  if (condition) {
    pass(name, detail);
  } else {
    fail(name, failReason);
  }
}

/* ── 1. Query Classification Tests ─────────────────────── */

async function testQueryClassification() {
  section("Query Classification");

  // Address detection — use a plausible Solana base58 address (32-44 chars)
  const fakeAddress = "So11111111111111111111111111111111";
  try {
    const res = await searchAPI(fakeAddress);
    assert(
      res.search_strategy === "address",
      "Address query → strategy 'address'",
      `Expected strategy "address", got "${res.search_strategy}"`,
      `engine=${res.search_engine}`
    );
  } catch (e: unknown) {
    fail("Address query → strategy 'address'", `Request failed: ${(e as Error).message}`);
  }

  // Uppercase symbol 4+ chars → exact_symbol
  try {
    const res = await searchAPI("BONK");
    assert(
      res.search_strategy === "exact_symbol",
      "Uppercase symbol 'BONK' → strategy 'exact_symbol'",
      `Expected strategy "exact_symbol", got "${res.search_strategy}"`,
      `engine=${res.search_engine}`
    );
  } catch (e: unknown) {
    fail("Uppercase symbol 'BONK' → strategy 'exact_symbol'", `Request failed: ${(e as Error).message}`);
  }

  // Short prefix ≤3 chars → prefix
  try {
    const res = await searchAPI("BON");
    assert(
      res.search_strategy === "prefix",
      "Short prefix 'BON' → strategy 'prefix'",
      `Expected strategy "prefix", got "${res.search_strategy}"`,
      `engine=${res.search_engine}`
    );
  } catch (e: unknown) {
    fail("Short prefix 'BON' → strategy 'prefix'", `Request failed: ${(e as Error).message}`);
  }

  // Multi-word query without semantic triggers → fts
  try {
    const res = await searchAPI("trump token");
    assert(
      res.search_strategy === "fts",
      "Multi-word 'trump token' → strategy 'fts'",
      `Expected strategy "fts", got "${res.search_strategy}"`,
      `engine=${res.search_engine}`
    );
  } catch (e: unknown) {
    fail("Multi-word 'trump token' → strategy 'fts'", `Request failed: ${(e as Error).message}`);
  }

  // Single semantic keyword → semantic
  try {
    const res = await searchAPI("gaming");
    assert(
      res.search_strategy === "semantic",
      "Semantic keyword 'gaming' → strategy 'semantic'",
      `Expected strategy "semantic", got "${res.search_strategy}"`,
      `engine=${res.search_engine}`
    );
  } catch (e: unknown) {
    fail("Semantic keyword 'gaming' → strategy 'semantic'", `Request failed: ${(e as Error).message}`);
  }

  // Multi-word with semantic trigger → hybrid
  try {
    const res = await searchAPI("dog coins");
    // "dog" is a semantic trigger; multi-word → hybrid
    assert(
      res.search_strategy === "hybrid",
      "Hybrid trigger 'dog coins' → strategy 'hybrid'",
      `Expected strategy "hybrid", got "${res.search_strategy}"`,
      `engine=${res.search_engine}`
    );
  } catch (e: unknown) {
    fail("Hybrid trigger 'dog coins' → strategy 'hybrid'", `Request failed: ${(e as Error).message}`);
  }

  // Another exact symbol
  try {
    const res = await searchAPI("SOL");
    assert(
      res.search_strategy === "prefix",
      "Short uppercase 'SOL' (3 chars) → strategy 'prefix'",
      `Expected strategy "prefix", got "${res.search_strategy}"`,
      `engine=${res.search_engine}, 3-char symbols go through prefix path`
    );
  } catch (e: unknown) {
    fail("Short uppercase 'SOL' → strategy 'prefix'", `Request failed: ${(e as Error).message}`);
  }

  // Lowercase multi-word → fts
  try {
    const res = await searchAPI("solana ecosystem");
    assert(
      res.search_strategy === "fts",
      "Lowercase multi-word → strategy 'fts'",
      `Expected strategy "fts", got "${res.search_strategy}"`,
      `engine=${res.search_engine}`
    );
  } catch (e: unknown) {
    fail("Lowercase multi-word → strategy 'fts'", `Request failed: ${(e as Error).message}`);
  }

  // Single semantic keyword "meme" → semantic
  try {
    const res = await searchAPI("meme");
    assert(
      res.search_strategy === "semantic",
      "Semantic keyword 'meme' → strategy 'semantic'",
      `Expected strategy "semantic", got "${res.search_strategy}"`,
      `engine=${res.search_engine}`
    );
  } catch (e: unknown) {
    fail("Semantic keyword 'meme' → strategy 'semantic'", `Request failed: ${(e as Error).message}`);
  }
}

/* ── 2. Result Quality Tests ───────────────────────────── */

async function testResultQuality() {
  section("Result Quality");

  // BONK returns tokens with matching symbol
  try {
    const res = await searchAPI("BONK");
    const hasBonk = res.tokens.some(
      (t) => t.token_base_symbol?.toUpperCase() === "BONK"
    );
    if (res.tokens.length === 0) {
      skip("'BONK' returns BONK tokens", "No results (DB may be empty or token not seeded)");
    } else {
      assert(
        hasBonk,
        "'BONK' returns BONK tokens",
        `None of ${res.tokens.length} tokens have symbol BONK. Got: ${res.tokens.map((t) => t.token_base_symbol).join(", ")}`,
        `${res.tokens.length} results`
      );
    }
  } catch (e: unknown) {
    fail("'BONK' returns BONK tokens", `Request failed: ${(e as Error).message}`);
  }

  // SOL returns SOL-related tokens
  try {
    const res = await searchAPI("SOL");
    const hasSol = res.tokens.some(
      (t) =>
        t.token_base_symbol?.toUpperCase().includes("SOL") ||
        (t.token_name || "").toUpperCase().includes("SOL")
    );
    if (res.tokens.length === 0) {
      skip("'SOL' returns SOL-related tokens", "No results");
    } else {
      assert(
        hasSol,
        "'SOL' returns SOL-related tokens",
        `None of ${res.tokens.length} tokens relate to SOL. Got: ${res.tokens.map((t) => t.token_base_symbol).join(", ")}`,
        `${res.tokens.length} results`
      );
    }
  } catch (e: unknown) {
    fail("'SOL' returns SOL-related tokens", `Request failed: ${(e as Error).message}`);
  }

  // dog coins returns dog/meme-related tokens
  try {
    const res = await searchAPI("dog coins");
    const dogRelated = ["DOG", "DOGE", "SHIB", "FLOKI", "WIF", "BONK", "MYRO"];
    const hasDogToken = res.tokens.some(
      (t) =>
        dogRelated.some((d) => t.token_base_symbol?.toUpperCase().includes(d)) ||
        (t.token_name || "").toLowerCase().includes("dog") ||
        (t.token_name || "").toLowerCase().includes("doge") ||
        (t.token_name || "").toLowerCase().includes("shib") ||
        (t.token_name || "").toLowerCase().includes("inu")
    );
    if (res.tokens.length === 0) {
      skip("'dog coins' returns dog-related tokens", "No results (vector/FTS may not have dog data)");
    } else {
      assert(
        hasDogToken,
        "'dog coins' returns dog-related tokens",
        `None of ${res.tokens.length} tokens are dog-related. Got: ${res.tokens.map((t) => `${t.token_base_symbol}(${t.token_name})`).join(", ")}`,
        `${res.tokens.length} results`
      );
    }
  } catch (e: unknown) {
    fail("'dog coins' returns dog-related tokens", `Request failed: ${(e as Error).message}`);
  }

  // gaming returns gaming-related tokens
  try {
    const res = await searchAPI("gaming");
    if (res.tokens.length === 0) {
      skip("'gaming' returns gaming-related tokens", "No results (vector search may not have gaming data)");
    } else {
      // We just check we got some results — semantic results are hard to validate exactly
      pass("'gaming' returns results", `${res.tokens.length} tokens, engine=${res.search_engine}`);
    }
  } catch (e: unknown) {
    fail("'gaming' returns results", `Request failed: ${(e as Error).message}`);
  }

  // Empty / too-short queries
  try {
    const res = await searchAPI("");
    assert(
      res.tokens.length === 0,
      "Empty query returns empty results",
      `Expected 0 tokens, got ${res.tokens.length}`,
    );
  } catch (e: unknown) {
    fail("Empty query returns empty results", `Request failed: ${(e as Error).message}`);
  }

  try {
    const res = await searchAPI("a");
    assert(
      res.tokens.length === 0,
      "Single-char query 'a' returns empty results",
      `Expected 0 tokens, got ${res.tokens.length}`,
    );
  } catch (e: unknown) {
    fail("Single-char query 'a' returns empty results", `Request failed: ${(e as Error).message}`);
  }

  // Response shape validation
  try {
    const res = await searchAPI("BONK");
    assert(
      Array.isArray(res.tokens),
      "Response has tokens array",
      `tokens is not an array: ${typeof res.tokens}`,
    );
    assert(
      Array.isArray(res.events),
      "Response has events array",
      `events is not an array: ${typeof res.events}`,
    );
    assert(
      typeof res.search_engine === "string",
      "Response has search_engine string",
      `search_engine is ${typeof res.search_engine}`,
    );
    assert(
      typeof res.search_strategy === "string",
      "Response has search_strategy string",
      `search_strategy is ${typeof res.search_strategy}`,
    );
    if (res.tokens.length > 0) {
      const t = res.tokens[0];
      const requiredFields = [
        "address",
        "token_base_symbol",
        "token_base_address",
        "price_usd",
      ];
      const missing = requiredFields.filter((f) => !(f in t));
      assert(
        missing.length === 0,
        "Token results have required fields",
        `Missing fields: ${missing.join(", ")}`,
        `Checked: ${requiredFields.join(", ")}`,
      );
    }
  } catch (e: unknown) {
    fail("Response shape validation", `Request failed: ${(e as Error).message}`);
  }
}

/* ── 3. Filter Tests ───────────────────────────────────── */

async function testFilters() {
  section("Natural Language Filters");

  // "dog coins under $1" → filter price ≤ $1
  try {
    const res = await searchAPI("dog coins under $1");
    const hasFilter = (res.filters_applied || []).some((f) =>
      f.toLowerCase().includes("price") && f.includes("1")
    );
    assert(
      hasFilter,
      "'dog coins under $1' → has price filter",
      `Expected a price filter in filters_applied, got: ${JSON.stringify(res.filters_applied)}`,
      `filters=${JSON.stringify(res.filters_applied)}`,
    );

    // All results should have price < 1
    if (res.tokens.length > 0) {
      const allUnder1 = res.tokens.every(
        (t) => t.price_usd === null || Number(t.price_usd) <= 1
      );
      assert(
        allUnder1,
        "'dog coins under $1' → all results price ≤ $1",
        `Some tokens have price > $1: ${res.tokens
          .filter((t) => Number(t.price_usd) > 1)
          .map((t) => `${t.token_base_symbol}=$${t.price_usd}`)
          .join(", ")}`,
        `${res.tokens.length} results checked`,
      );
    } else {
      skip("'dog coins under $1' → all results price ≤ $1", "No results to validate");
    }
  } catch (e: unknown) {
    fail("'dog coins under $1' filter test", `Request failed: ${(e as Error).message}`);
  }

  // "tokens up 30%" → filter 24h ≥ +30%
  try {
    const res = await searchAPI("tokens up 30%");
    const hasFilter = (res.filters_applied || []).some((f) =>
      f.includes("24h") && f.includes("30")
    );
    assert(
      hasFilter,
      "'tokens up 30%' → has 24h change filter",
      `Expected a 24h filter, got: ${JSON.stringify(res.filters_applied)}`,
      `filters=${JSON.stringify(res.filters_applied)}`,
    );

    if (res.tokens.length > 0) {
      const allUp = res.tokens.every(
        (t) => t.price_change_24h === null || Number(t.price_change_24h) >= 30
      );
      assert(
        allUp,
        "'tokens up 30%' → all results change ≥ 30%",
        `Some tokens have change < 30%: ${res.tokens
          .filter((t) => Number(t.price_change_24h) < 30)
          .map((t) => `${t.token_base_symbol}=${t.price_change_24h}%`)
          .join(", ")}`,
        `${res.tokens.length} results checked`,
      );
    } else {
      skip("'tokens up 30%' → all results change ≥ 30%", "No results to validate");
    }
  } catch (e: unknown) {
    fail("'tokens up 30%' filter test", `Request failed: ${(e as Error).message}`);
  }

  // "coins over $100" → filter price ≥ $100
  try {
    const res = await searchAPI("coins over $100");
    const hasFilter = (res.filters_applied || []).some((f) =>
      f.toLowerCase().includes("price") && f.includes("100")
    );
    assert(
      hasFilter,
      "'coins over $100' → has price ≥ $100 filter",
      `Expected a price filter, got: ${JSON.stringify(res.filters_applied)}`,
      `filters=${JSON.stringify(res.filters_applied)}`,
    );

    if (res.tokens.length > 0) {
      const allOver100 = res.tokens.every(
        (t) => t.price_usd === null || Number(t.price_usd) >= 100
      );
      assert(
        allOver100,
        "'coins over $100' → all results price ≥ $100",
        `Some tokens have price < $100: ${res.tokens
          .filter((t) => Number(t.price_usd) < 100)
          .map((t) => `${t.token_base_symbol}=$${t.price_usd}`)
          .join(", ")}`,
        `${res.tokens.length} results checked`,
      );
    } else {
      skip("'coins over $100' → all results price ≥ $100", "No results (few tokens above $100)");
    }
  } catch (e: unknown) {
    fail("'coins over $100' filter test", `Request failed: ${(e as Error).message}`);
  }

  // "gaming volume over $10K" → has volume filter
  try {
    const res = await searchAPI("gaming volume over $10K");
    const hasVolFilter = (res.filters_applied || []).some((f) =>
      f.toLowerCase().includes("vol")
    );
    assert(
      hasVolFilter,
      "'gaming volume over $10K' → has volume filter",
      `Expected a volume filter, got: ${JSON.stringify(res.filters_applied)}`,
      `filters=${JSON.stringify(res.filters_applied)}`,
    );
  } catch (e: unknown) {
    fail("'gaming volume over $10K' filter test", `Request failed: ${(e as Error).message}`);
  }

  // "tokens down 20%" → filter 24h ≤ -20%
  try {
    const res = await searchAPI("tokens down 20%");
    const hasFilter = (res.filters_applied || []).some((f) =>
      f.includes("24h") && f.includes("20")
    );
    assert(
      hasFilter,
      "'tokens down 20%' → has 24h negative change filter",
      `Expected a 24h filter, got: ${JSON.stringify(res.filters_applied)}`,
      `filters=${JSON.stringify(res.filters_applied)}`,
    );
  } catch (e: unknown) {
    fail("'tokens down 20%' filter test", `Request failed: ${(e as Error).message}`);
  }

  // "meme coins under $0.01 volume over $50K" → multiple filters
  try {
    const res = await searchAPI("meme coins under $0.01 volume over $50K");
    const filters = res.filters_applied || [];
    const hasPriceFilter = filters.some((f) => f.toLowerCase().includes("price"));
    const hasVolFilter = filters.some((f) => f.toLowerCase().includes("vol"));
    assert(
      hasPriceFilter && hasVolFilter,
      "Combined filter: price + volume both extracted",
      `Expected price AND volume filters, got: ${JSON.stringify(filters)}`,
      `filters=${JSON.stringify(filters)}`,
    );
  } catch (e: unknown) {
    fail("Combined filter test", `Request failed: ${(e as Error).message}`);
  }
}

/* ── 4. Deduplication Tests ────────────────────────────── */

async function testDeduplication() {
  section("Deduplication");

  for (const query of ["SOL", "BONK", "TRUMP"]) {
    try {
      const res = await searchAPI(query);
      if (res.tokens.length <= 1) {
        skip(
          `'${query}' has unique token_base_address`,
          `Only ${res.tokens.length} result(s)`
        );
        continue;
      }

      const addresses = res.tokens.map((t) => t.token_base_address).filter(Boolean);
      const uniqueAddresses = new Set(addresses);
      assert(
        addresses.length === uniqueAddresses.size,
        `'${query}' has unique token_base_address (no duplicates)`,
        `Found ${addresses.length - uniqueAddresses.size} duplicate(s) among ${addresses.length} results. Duplicates: ${
          addresses.filter((a, i) => addresses.indexOf(a) !== i).join(", ")
        }`,
        `${addresses.length} results, all unique`,
      );
    } catch (e: unknown) {
      fail(`'${query}' dedup test`, `Request failed: ${(e as Error).message}`);
    }
  }
}

/* ── 5. Performance Tests ──────────────────────────────── */

async function testPerformance() {
  section("Performance");

  const queries = ["BONK", "SOL", "dog coins", "gaming", "trump token"];
  const COLD_THRESHOLD = 5000; // 5s generous for cold start
  const WARM_THRESHOLD = 2000; // 2s for warm/cached

  // Cold run — first time for each query
  for (const q of queries) {
    try {
      const start = performance.now();
      const res = await searchAPI(q);
      const elapsed = Math.round(performance.now() - start);
      const serverTime = res.query_time_ms ?? elapsed;

      assert(
        elapsed < COLD_THRESHOLD,
        `Cold: '${q}' completes in < ${COLD_THRESHOLD}ms`,
        `Took ${elapsed}ms (server: ${serverTime}ms)`,
        `${elapsed}ms total, ${serverTime}ms server`,
      );
    } catch (e: unknown) {
      fail(`Cold: '${q}' performance`, `Request failed: ${(e as Error).message}`);
    }
  }

  // Warm run — repeat same queries (should be faster due to caching)
  for (const q of queries) {
    try {
      const start = performance.now();
      const res = await searchAPI(q);
      const elapsed = Math.round(performance.now() - start);
      const serverTime = res.query_time_ms ?? elapsed;

      assert(
        elapsed < WARM_THRESHOLD,
        `Warm: '${q}' completes in < ${WARM_THRESHOLD}ms`,
        `Took ${elapsed}ms (server: ${serverTime}ms), threshold ${WARM_THRESHOLD}ms`,
        `${elapsed}ms total, ${serverTime}ms server`,
      );
    } catch (e: unknown) {
      fail(`Warm: '${q}' performance`, `Request failed: ${(e as Error).message}`);
    }
  }

  // query_time_ms is present and reasonable
  try {
    const res = await searchAPI("BONK");
    assert(
      typeof res.query_time_ms === "number" && res.query_time_ms >= 0,
      "query_time_ms is a non-negative number",
      `query_time_ms = ${res.query_time_ms} (type: ${typeof res.query_time_ms})`,
      `${res.query_time_ms}ms`,
    );
  } catch (e: unknown) {
    fail("query_time_ms validation", `Request failed: ${(e as Error).message}`);
  }
}

/* ── 6. Edge Case Tests ────────────────────────────────── */

async function testEdgeCases() {
  section("Edge Cases");

  // Single character → empty
  try {
    const res = await searchAPI("x");
    assert(
      res.tokens.length === 0,
      "Single char 'x' → empty results",
      `Expected 0 tokens, got ${res.tokens.length}`,
    );
  } catch (e: unknown) {
    fail("Single char 'x' → empty results", `Request failed: ${(e as Error).message}`);
  }

  // Very long query — should not crash
  try {
    const longQuery = "a]".repeat(500);
    const res = await searchAPI(longQuery);
    pass("Very long query (1000 chars) → does not crash", `${res.tokens.length} results`);
  } catch (e: unknown) {
    const msg = (e as Error).message;
    // A 414 URI Too Long or similar HTTP error is acceptable; a connection error is not
    if (msg.includes("414") || msg.includes("URI")) {
      pass("Very long query → HTTP 414 (acceptable)", msg);
    } else if (msg.includes("HTTP")) {
      // Non-200 but didn't crash the server
      pass("Very long query → returned HTTP error (server didn't crash)", msg);
    } else {
      fail("Very long query → does not crash", `Unexpected error: ${msg}`);
    }
  }

  // SQL injection attempt — should not crash or leak
  try {
    const sqlInjection = "'; DROP TABLE pools; --";
    const res = await searchAPI(sqlInjection);
    pass(
      "SQL injection attempt → does not crash",
      `${res.tokens.length} results, engine=${res.search_engine}`,
    );
  } catch (e: unknown) {
    const msg = (e as Error).message;
    if (msg.includes("HTTP")) {
      pass("SQL injection → returned HTTP error (safe)", msg);
    } else {
      fail("SQL injection attempt → does not crash", `Error: ${msg}`);
    }
  }

  // XSS attempt — should not crash
  try {
    const xss = '<script>alert("xss")</script>';
    const res = await searchAPI(xss);
    pass("XSS attempt → does not crash", `${res.tokens.length} results`);
  } catch (e: unknown) {
    const msg = (e as Error).message;
    if (msg.includes("HTTP")) {
      pass("XSS attempt → returned HTTP error (safe)", msg);
    } else {
      fail("XSS attempt → does not crash", `Error: ${msg}`);
    }
  }

  // Unicode query — should not crash
  try {
    const unicodeQuery = "比特币 以太坊";
    const res = await searchAPI(unicodeQuery);
    pass("Unicode query → does not crash", `${res.tokens.length} results, strategy=${res.search_strategy}`);
  } catch (e: unknown) {
    const msg = (e as Error).message;
    if (msg.includes("HTTP")) {
      pass("Unicode query → returned HTTP error (safe)", msg);
    } else {
      fail("Unicode query → does not crash", `Error: ${msg}`);
    }
  }

  // Emoji query — should not crash
  try {
    const emojiQuery = "🐶 🚀 moon";
    const res = await searchAPI(emojiQuery);
    pass("Emoji query → does not crash", `${res.tokens.length} results`);
  } catch (e: unknown) {
    const msg = (e as Error).message;
    if (msg.includes("HTTP")) {
      pass("Emoji query → returned HTTP error (safe)", msg);
    } else {
      fail("Emoji query → does not crash", `Error: ${msg}`);
    }
  }

  // Stop words only → empty or graceful
  try {
    const res = await searchAPI("the a an");
    // "the a an" — each word is ≤ 3 chars, so prefix. Or could be fts. Either way, graceful.
    pass(
      "Stop words only 'the a an' → graceful response",
      `${res.tokens.length} results, strategy=${res.search_strategy}`,
    );
  } catch (e: unknown) {
    fail("Stop words only → graceful response", `Request failed: ${(e as Error).message}`);
  }

  // Whitespace-only query → empty
  try {
    const res = await searchAPI("   ");
    assert(
      res.tokens.length === 0,
      "Whitespace-only query → empty results",
      `Expected 0 tokens, got ${res.tokens.length}`,
    );
  } catch (e: unknown) {
    fail("Whitespace-only query → empty results", `Request failed: ${(e as Error).message}`);
  }

  // Repeated special chars
  try {
    const res = await searchAPI("$$$%%%^^^");
    pass("Special chars '$$%%%^^^' → does not crash", `${res.tokens.length} results`);
  } catch (e: unknown) {
    const msg = (e as Error).message;
    if (msg.includes("HTTP")) {
      pass("Special chars → returned HTTP error (safe)", msg);
    } else {
      fail("Special chars → does not crash", `Error: ${msg}`);
    }
  }

  // Null byte
  try {
    const res = await searchAPI("BONK\x00ATTACK");
    pass("Null byte in query → does not crash", `${res.tokens.length} results`);
  } catch (e: unknown) {
    const msg = (e as Error).message;
    if (msg.includes("HTTP")) {
      pass("Null byte → returned HTTP error (safe)", msg);
    } else {
      fail("Null byte in query → does not crash", `Error: ${msg}`);
    }
  }
}

/* ── 7. Search Engine Label Tests ──────────────────────── */

async function testSearchEngineLabels() {
  section("Search Engine Labels");

  // Address → "exact"
  try {
    const fakeAddress = "So11111111111111111111111111111111";
    const res = await searchAPI(fakeAddress);
    assert(
      res.search_engine === "exact",
      "Address → search_engine 'exact'",
      `Expected "exact", got "${res.search_engine}"`,
    );
  } catch (e: unknown) {
    fail("Address → search_engine 'exact'", `Request failed: ${(e as Error).message}`);
  }

  // exact_symbol → "exact"
  try {
    const res = await searchAPI("BONK");
    assert(
      res.search_engine === "exact",
      "Exact symbol → search_engine 'exact'",
      `Expected "exact", got "${res.search_engine}"`,
    );
  } catch (e: unknown) {
    fail("Exact symbol → search_engine 'exact'", `Request failed: ${(e as Error).message}`);
  }

  // prefix → "prefix"
  try {
    const res = await searchAPI("BON");
    assert(
      res.search_engine === "prefix",
      "Prefix → search_engine 'prefix'",
      `Expected "prefix", got "${res.search_engine}"`,
    );
  } catch (e: unknown) {
    fail("Prefix → search_engine 'prefix'", `Request failed: ${(e as Error).message}`);
  }

  // Valid engine labels
  try {
    const res = await searchAPI("dog coins");
    const validEngines = ["exact", "prefix", "fts", "vector", "hybrid", "like_fallback"];
    assert(
      validEngines.includes(res.search_engine),
      "search_engine is a valid label",
      `Got "${res.search_engine}", expected one of: ${validEngines.join(", ")}`,
      `engine=${res.search_engine}`,
    );
  } catch (e: unknown) {
    fail("search_engine is a valid label", `Request failed: ${(e as Error).message}`);
  }
}

/* ── 8. Filter-Only Tests ──────────────────────────────── */

async function testFilterOnly() {
  section("Filter-Only Queries (no search text)");

  // "coins under $1" where "coins" is a stop word → filter-only
  try {
    const res = await searchAPI("tokens under $0.001");
    const hasFilter = (res.filters_applied || []).some((f) =>
      f.toLowerCase().includes("price")
    );
    assert(
      hasFilter,
      "'tokens under $0.001' → has price filter",
      `Expected price filter, got: ${JSON.stringify(res.filters_applied)}`,
      `filters=${JSON.stringify(res.filters_applied)}`,
    );
    if (res.tokens.length > 0) {
      const allMatch = res.tokens.every(
        (t) => t.price_usd === null || Number(t.price_usd) <= 0.001
      );
      assert(
        allMatch,
        "'tokens under $0.001' → all results ≤ $0.001",
        `Some tokens exceed $0.001: ${res.tokens
          .filter((t) => Number(t.price_usd) > 0.001)
          .map((t) => `${t.token_base_symbol}=$${t.price_usd}`)
          .slice(0, 5)
          .join(", ")}`,
        `${res.tokens.length} results checked`,
      );
    } else {
      skip("'tokens under $0.001' → results validation", "No results matching filter");
    }
  } catch (e: unknown) {
    fail("'tokens under $0.001' filter-only test", `Request failed: ${(e as Error).message}`);
  }
}

/* ── 9. Result Limit Tests ─────────────────────────────── */

async function testResultLimits() {
  section("Result Limits");

  // Results should be capped at 10
  try {
    const res = await searchAPI("SOL");
    assert(
      res.tokens.length <= 10,
      "Results capped at ≤ 10 tokens",
      `Got ${res.tokens.length} tokens, expected ≤ 10`,
      `${res.tokens.length} results`,
    );
  } catch (e: unknown) {
    fail("Results capped at ≤ 10", `Request failed: ${(e as Error).message}`);
  }

  // Results are sorted by volume (for non-RRF)
  try {
    const res = await searchAPI("SOL");
    if (res.tokens.length >= 2) {
      // For prefix/exact searches, results should be sorted by volume desc
      const volumes = res.tokens.map((t) => Number(t.volume_24h || 0));
      let sorted = true;
      for (let i = 1; i < volumes.length; i++) {
        if (volumes[i] > volumes[i - 1] * 1.01) {
          // small tolerance for floating point
          sorted = false;
          break;
        }
      }
      assert(
        sorted,
        "Results are sorted by volume (descending)",
        `Volumes not descending: ${volumes.slice(0, 5).map((v) => v.toFixed(0)).join(" > ")}`,
        `Top volumes: ${volumes.slice(0, 3).map((v) => `$${v.toFixed(0)}`).join(", ")}`,
      );
    } else {
      skip("Results sorted by volume", `Only ${res.tokens.length} result(s)`);
    }
  } catch (e: unknown) {
    fail("Results sorted by volume", `Request failed: ${(e as Error).message}`);
  }
}

/* ── Runner ─────────────────────────────────────────────── */

async function run() {
  console.log();
  console.log(`${BOLD}CHAINSCOPE Search API Test Suite${RESET}`);
  console.log(`${DIM}Target: ${BASE_URL}/api/search${RESET}`);
  console.log(`${DIM}Time:   ${new Date().toISOString()}${RESET}`);

  // Connectivity check
  try {
    const probe = await fetch(`${BASE_URL}/api/search?q=test`);
    if (!probe.ok) throw new Error(`HTTP ${probe.status}`);
    console.log(`${GREEN}Server reachable${RESET}`);
  } catch (e: unknown) {
    console.error();
    console.error(`${RED}${BOLD}Cannot reach server at ${BASE_URL}${RESET}`);
    console.error(`${RED}Make sure the dev server is running:  npm run dev${RESET}`);
    console.error(`${DIM}Error: ${(e as Error).message}${RESET}`);
    process.exit(1);
  }

  const startTime = performance.now();

  await testQueryClassification();
  await testResultQuality();
  await testFilters();
  await testDeduplication();
  await testPerformance();
  await testEdgeCases();
  await testSearchEngineLabels();
  await testFilterOnly();
  await testResultLimits();

  const totalTime = Math.round(performance.now() - startTime);

  // Summary
  console.log();
  console.log(`${BOLD}${"─".repeat(50)}${RESET}`);
  console.log(`${BOLD}Summary${RESET}`);
  console.log(`${BOLD}${"─".repeat(50)}${RESET}`);
  console.log(`  ${GREEN}Passed:  ${totalPassed}${RESET}`);
  if (totalFailed > 0) {
    console.log(`  ${RED}Failed:  ${totalFailed}${RESET}`);
  } else {
    console.log(`  ${DIM}Failed:  0${RESET}`);
  }
  if (totalSkipped > 0) {
    console.log(`  ${YELLOW}Skipped: ${totalSkipped}${RESET}`);
  }
  console.log(`  ${DIM}Total:   ${totalPassed + totalFailed + totalSkipped} tests in ${totalTime}ms${RESET}`);

  if (failedTests.length > 0) {
    console.log();
    console.log(`${RED}${BOLD}Failed Tests:${RESET}`);
    for (const f of failedTests) {
      console.log(`  ${RED}- ${f}${RESET}`);
    }
  }

  console.log();
  if (totalFailed === 0) {
    console.log(`${GREEN}${BOLD}All tests passed!${RESET}`);
  } else {
    console.log(`${RED}${BOLD}${totalFailed} test(s) failed.${RESET}`);
  }
  console.log();

  process.exit(totalFailed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error(`${RED}Unhandled error:${RESET}`, err);
  process.exit(2);
});
