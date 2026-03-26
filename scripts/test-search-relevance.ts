/**
 * Search Relevance Test — verifies that returned results ACTUALLY match the intent
 *
 * Unlike the basic test (does it crash? does it return something?), this test
 * checks that the DATA in the results is correct:
 * - Price filters: all returned tokens actually have price in range
 * - Volume filters: all returned tokens actually have volume matching
 * - DEX filters: all returned tokens are on the right DEX
 * - Sort: results are actually sorted correctly
 * - Semantic: expected tokens appear in results
 *
 * Usage: npx tsx scripts/test-search-relevance.ts [base_url]
 */

const BASE_URL = process.argv[2] || "http://localhost:3099";

interface Token {
  token_base_symbol: string;
  token_base_address: string;
  price_usd: number;
  volume_24h: number;
  price_change_24h: number;
  liquidity_usd: number;
  market_cap: number;
  dex: string;
  pool_created_at: string | null;
  holder_count: number | null;
  risk_score: number | null;
  is_verified: number | null;
  is_mintable: number | null;
  whale_events_24h: number;
  txns_24h_buys: number;
  txns_24h_sells: number;
  [key: string]: any; // eslint-disable-line
}

interface SearchResponse {
  tokens: Token[];
  events: any[]; // eslint-disable-line
  search_engine: string;
  search_strategy: string;
  filters_applied: string[];
  query_time_ms: number;
}

// ── Test definitions ─────────────────────────────────────

interface RelevanceTest {
  id: number;
  query: string;
  intent: string;
  // Validators run on each returned token — ALL must pass
  tokenValidator?: (t: Token) => { pass: boolean; reason: string };
  // Sort validator — checks ordering of the full result set
  sortValidator?: (tokens: Token[]) => { pass: boolean; reason: string };
  // Must-include: at least one of these symbols should appear
  mustInclude?: string[];
  // Must-not-include: none of these symbols should appear
  mustNotInclude?: string[];
  // Minimum results expected
  minResults?: number;
  // Check filters_applied contains these strings
  expectFilters?: string[];
}

const tests: RelevanceTest[] = [
  // ── Price filters: verify actual price values ──
  {
    id: 9,
    query: "tokens under 1 cent",
    intent: "모든 결과 price ≤ $0.01",
    tokenValidator: (t) => ({
      pass: t.price_usd <= 0.011, // small tolerance
      reason: `${t.token_base_symbol} price=$${t.price_usd} > $0.01`,
    }),
    minResults: 1,
  },
  {
    id: 11,
    query: "meme coins under $0.001",
    intent: "모든 결과 price ≤ $0.001",
    tokenValidator: (t) => ({
      pass: t.price_usd <= 0.0011,
      reason: `${t.token_base_symbol} price=$${t.price_usd} > $0.001`,
    }),
    minResults: 1,
  },
  {
    id: 12,
    query: "tokens between $1 and $5",
    intent: "모든 결과 $1 ≤ price ≤ $5",
    tokenValidator: (t) => ({
      pass: t.price_usd >= 0.99 && t.price_usd <= 5.01,
      reason: `${t.token_base_symbol} price=$${t.price_usd} outside $1-$5`,
    }),
    minResults: 1,
  },
  {
    id: 16,
    query: "sub penny tokens",
    intent: "모든 결과 price ≤ $0.01",
    tokenValidator: (t) => ({
      pass: t.price_usd <= 0.011,
      reason: `${t.token_base_symbol} price=$${t.price_usd} > $0.01`,
    }),
    minResults: 1,
  },
  {
    id: 10,
    query: "SOL pairs above $10",
    intent: "모든 결과 price ≥ $10",
    tokenValidator: (t) => ({
      pass: t.price_usd >= 9.99,
      reason: `${t.token_base_symbol} price=$${t.price_usd} < $10`,
    }),
    expectFilters: ["price ≥"],
  },

  // ── Volume filters: verify actual volume values ──
  {
    id: 20,
    query: "tokens with over 1M volume",
    intent: "모든 결과 volume ≥ $1M",
    tokenValidator: (t) => ({
      pass: t.volume_24h >= 999_000,
      reason: `${t.token_base_symbol} vol=$${t.volume_24h} < $1M`,
    }),
    expectFilters: ["vol ≥"],
  },
  {
    id: 21,
    query: "liquidity above 500k",
    intent: "모든 결과 liquidity ≥ $500K",
    tokenValidator: (t) => ({
      pass: t.liquidity_usd >= 499_000,
      reason: `${t.token_base_symbol} liq=$${t.liquidity_usd} < $500K`,
    }),
    expectFilters: ["liq ≥"],
  },
  {
    id: 26,
    query: "dead volume tokens",
    intent: "모든 결과 volume ≤ $100",
    tokenValidator: (t) => ({
      pass: t.volume_24h <= 101,
      reason: `${t.token_base_symbol} vol=$${t.volume_24h} > $100 (not dead)`,
    }),
    expectFilters: ["dead"],
  },

  // ── Percentage filters: verify actual change values ──
  {
    id: 30,
    query: "tokens up 100% this week",
    intent: "모든 결과 price_change_24h ≥ 100%",
    tokenValidator: (t) => ({
      pass: t.price_change_24h >= 99,
      reason: `${t.token_base_symbol} change=${t.price_change_24h}% < 100%`,
    }),
    minResults: 1,
  },
  {
    id: 34,
    query: "tokens down 90%",
    intent: "모든 결과 price_change_24h ≤ -90%",
    tokenValidator: (t) => ({
      pass: t.price_change_24h <= -89,
      reason: `${t.token_base_symbol} change=${t.price_change_24h}% > -90%`,
    }),
    minResults: 1,
  },
  {
    id: 36,
    query: "breakout tokens",
    intent: "모든 결과 price_change_24h ≥ 20%",
    tokenValidator: (t) => ({
      pass: t.price_change_24h >= 19,
      reason: `${t.token_base_symbol} change=${t.price_change_24h}% < 20%`,
    }),
    expectFilters: ["breakout"],
  },

  // ── DEX filters: verify actual DEX names ──
  {
    id: 51,
    query: "raydium top pairs",
    intent: "모든 결과 dex=Raydium",
    tokenValidator: (t) => ({
      pass: (t.dex || "").toLowerCase().includes("raydium"),
      reason: `${t.token_base_symbol} dex=${t.dex} (not Raydium)`,
    }),
    minResults: 1,
  },
  {
    id: 53,
    query: "meteora pools",
    intent: "모든 결과 dex=Meteora",
    tokenValidator: (t) => ({
      pass: (t.dex || "").toLowerCase().includes("meteora"),
      reason: `${t.token_base_symbol} dex=${t.dex} (not Meteora)`,
    }),
    minResults: 1,
  },
  {
    id: 89,
    query: "trending tokens not on jupiter",
    intent: "모든 결과 dex ≠ Jupiter",
    tokenValidator: (t) => ({
      pass: !(t.dex || "").toLowerCase().includes("jupiter"),
      reason: `${t.token_base_symbol} dex=${t.dex} (should NOT be Jupiter)`,
    }),
    expectFilters: ["exclude"],
  },

  // ── Sort validators ──
  {
    id: 27,
    query: "top gainers today",
    intent: "결과가 price_change_24h DESC로 정렬",
    sortValidator: (tokens) => {
      for (let i = 1; i < tokens.length; i++) {
        if (tokens[i].price_change_24h > tokens[i - 1].price_change_24h + 0.01) {
          return { pass: false, reason: `[${i-1}] ${tokens[i-1].price_change_24h}% → [${i}] ${tokens[i].price_change_24h}% (not DESC)` };
        }
      }
      return { pass: true, reason: "sorted DESC" };
    },
    expectFilters: ["price_change_24h DESC"],
  },
  {
    id: 17,
    query: "highest volume today",
    intent: "결과가 volume DESC로 정렬",
    sortValidator: (tokens) => {
      for (let i = 1; i < tokens.length; i++) {
        if (tokens[i].volume_24h > tokens[i - 1].volume_24h + 1) {
          return { pass: false, reason: `[${i-1}] vol=$${tokens[i-1].volume_24h} → [${i}] vol=$${tokens[i].volume_24h} (not DESC)` };
        }
      }
      return { pass: true, reason: "sorted DESC" };
    },
    expectFilters: ["volume_24h DESC"],
  },

  // ── Semantic: expected tokens should appear ──
  {
    id: 1,
    query: "BONK",
    intent: "BONK 토큰이 결과에 포함",
    mustInclude: ["BONK"],
    minResults: 1,
  },
  {
    id: 57,
    query: "trump tokens",
    intent: "TRUMP 관련 토큰이 결과에 포함",
    mustInclude: ["TRUMP"],
    minResults: 1,
  },
  {
    id: 7,
    query: "JUP/USDC",
    intent: "JUP 토큰이 결과에 포함",
    mustInclude: ["JUP"],
    minResults: 1,
  },

  // ── Safety filters: verify actual safety values ──
  {
    id: 73,
    query: "rug pull risk low",
    intent: "모든 결과 risk_score ≥ 50",
    tokenValidator: (t) => ({
      pass: (t.risk_score ?? 0) >= 49,
      reason: `${t.token_base_symbol} risk_score=${t.risk_score} < 50`,
    }),
    expectFilters: ["rug"],
  },

  // ── Mcap filters ──
  {
    id: 38,
    query: "mcap under 100k",
    intent: "모든 결과 market_cap ≤ $100K",
    tokenValidator: (t) => ({
      pass: !t.market_cap || t.market_cap <= 100_001,
      reason: `${t.token_base_symbol} mcap=$${t.market_cap} > $100K`,
    }),
    expectFilters: ["mcap ≤"],
  },

  // ── Comparison ──
  {
    id: 93,
    query: "BONK vs WIF",
    intent: "BONK과 WIF 둘 다 결과에 포함",
    mustInclude: ["BONK", "WIF"],
    minResults: 2,
  },

  // ── Combined filters ──
  {
    id: 87,
    query: "SOL pairs mcap under 500k volume over 100k",
    intent: "mcap ≤ 500K AND volume ≥ 100K",
    tokenValidator: (t) => {
      const mcapOk = !t.market_cap || t.market_cap <= 500_001;
      const volOk = t.volume_24h >= 99_000;
      return {
        pass: mcapOk && volOk,
        reason: `${t.token_base_symbol} mcap=$${t.market_cap} vol=$${t.volume_24h}`,
      };
    },
    expectFilters: ["mcap", "vol"],
  },

  // ── Buy/sell ratio ──
  {
    id: 82,
    query: "buy sell ratio bullish",
    intent: "모든 결과 buys > sells (ratio > 1.5)",
    tokenValidator: (t) => {
      const buys = t.txns_24h_buys || 0;
      const sells = t.txns_24h_sells || 1;
      const ratio = sells > 0 ? buys / sells : 999;
      return {
        pass: ratio >= 1.4,
        reason: `${t.token_base_symbol} buys=${buys} sells=${sells} ratio=${ratio.toFixed(2)}`,
      };
    },
    expectFilters: ["bullish"],
  },
];

// ── Runner ───────────────────────────────────────────────

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

async function runTest(test: RelevanceTest): Promise<{ pass: boolean; details: string[] }> {
  const details: string[] = [];
  try {
    const url = `${BASE_URL}/api/search?q=${encodeURIComponent(test.query)}`;
    const resp = await fetch(url);
    const data: SearchResponse = await resp.json();
    const tokens = data.tokens || [];

    // Check minimum results
    if (test.minResults && tokens.length < test.minResults) {
      details.push(`Expected ≥ ${test.minResults} results, got ${tokens.length}`);
      return { pass: false, details };
    }

    // Check expected filters
    if (test.expectFilters) {
      for (const ef of test.expectFilters) {
        const found = data.filters_applied?.some((f) => f.toLowerCase().includes(ef.toLowerCase()));
        if (!found) {
          details.push(`Missing expected filter containing "${ef}" in [${data.filters_applied?.join(", ")}]`);
          return { pass: false, details };
        }
      }
    }

    // Check must-include tokens
    if (test.mustInclude) {
      const syms = tokens.map((t) => t.token_base_symbol?.toUpperCase());
      for (const must of test.mustInclude) {
        if (!syms.some((s) => s?.includes(must.toUpperCase()))) {
          details.push(`Expected ${must} in results but got: [${syms.join(", ")}]`);
          return { pass: false, details };
        }
      }
    }

    // Check must-not-include tokens
    if (test.mustNotInclude) {
      const syms = tokens.map((t) => t.token_base_symbol?.toUpperCase());
      for (const must of test.mustNotInclude) {
        if (syms.some((s) => s?.includes(must.toUpperCase()))) {
          details.push(`${must} should NOT be in results but was found`);
          return { pass: false, details };
        }
      }
    }

    // Validate each token
    if (test.tokenValidator && tokens.length > 0) {
      let failures = 0;
      for (const t of tokens) {
        const result = test.tokenValidator(t);
        if (!result.pass) {
          details.push(`  ✗ ${result.reason}`);
          failures++;
        }
      }
      if (failures > 0) {
        details.unshift(`${failures}/${tokens.length} tokens failed validation:`);
        return { pass: false, details };
      }
      details.push(`${tokens.length}/${tokens.length} tokens passed validation`);
    }

    // Validate sort order
    if (test.sortValidator && tokens.length > 1) {
      const result = test.sortValidator(tokens);
      if (!result.pass) {
        details.push(`Sort validation failed: ${result.reason}`);
        return { pass: false, details };
      }
      details.push(`Sort order correct: ${result.reason}`);
    }

    if (tokens.length === 0 && !test.minResults) {
      details.push("0 results (filter correct but no matching data in DB)");
    }

    return { pass: true, details };
  } catch (err) {
    details.push(`ERROR: ${err}`);
    return { pass: false, details };
  }
}

async function main() {
  console.log(`\n${BOLD}Search Relevance Test${RESET}`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Tests: ${tests.length}`);
  console.log("═".repeat(80));

  // Check connectivity
  try {
    await fetch(`${BASE_URL}/api/search?q=test`);
  } catch {
    console.error(`\n${RED}Cannot reach ${BASE_URL}${RESET}`);
    process.exit(1);
  }

  let passed = 0;
  let failed = 0;
  const failures: { id: number; query: string; details: string[] }[] = [];

  for (const test of tests) {
    const result = await runTest(test);
    if (result.pass) {
      console.log(`${GREEN}  PASS${RESET} #${test.id} ${test.query} ${DIM}— ${test.intent}${RESET}`);
      if (result.details.length > 0) {
        console.log(`       ${DIM}${result.details[0]}${RESET}`);
      }
      passed++;
    } else {
      console.log(`${RED}  FAIL${RESET} #${test.id} ${test.query} ${DIM}— ${test.intent}${RESET}`);
      for (const d of result.details.slice(0, 5)) {
        console.log(`       ${RED}${d}${RESET}`);
      }
      failed++;
      failures.push({ id: test.id, query: test.query, details: result.details });
    }
  }

  console.log("\n" + "═".repeat(80));
  console.log(`${BOLD}Relevance Summary${RESET}`);
  console.log(`  ${GREEN}Passed: ${passed}${RESET}`);
  console.log(`  ${failed > 0 ? RED : GREEN}Failed: ${failed}${RESET}`);
  console.log(`  Total:  ${tests.length}`);

  if (failures.length > 0) {
    console.log(`\n${BOLD}${RED}Failed Tests:${RESET}`);
    for (const f of failures) {
      console.log(`  #${f.id} "${f.query}"`);
      for (const d of f.details.slice(0, 3)) {
        console.log(`    → ${d}`);
      }
    }
  }

  console.log();
  process.exit(failed > 0 ? 1 : 0);
}

main();
