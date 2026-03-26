/**
 * CHAINSCOPE Search Quality Eval Suite
 * Based on chainscope_search_eval.yaml
 *
 * 4 criteria per test (0-1 each, total 0-4):
 *   filter_match:        expected filters present in applied_filters
 *   sort_match:          expected sort applied
 *   result_consistency:  all returned results satisfy applied filters
 *   noise_check:         no irrelevant results in top positions
 *
 * Usage: npx tsx scripts/eval-search.ts [base_url]
 */

const BASE_URL = process.argv[2] || "http://localhost:3099";

interface Token {
  token_base_symbol: string;
  token_base_address: string;
  token_name: string;
  price_usd: number;
  volume_24h: number;
  price_change_24h: number;
  liquidity_usd: number;
  market_cap: number;
  dex: string;
  pool_created_at: string | null;
  risk_score: number | null;
  is_verified: number | null;
  is_mintable: number | null;
  _is_lp_burned: number | null;
  _lp_locked: number | null;
  [key: string]: any;
}

interface SearchResponse {
  tokens: Token[];
  events: any[];
  search_engine: string;
  search_strategy: string;
  filters_applied: string[];
  query_time_ms: number;
}

interface EvalResult {
  id: string;
  category: string;
  query: string;
  intent: string;
  filter_match: 0 | 1;
  sort_match: 0 | 1;
  result_consistency: 0 | 1;
  noise_check: 0 | 1;
  score: number;
  pass: boolean;
  fail_reasons: string[];
  result_count: number;
  engine: string;
  applied_filters: string[];
  query_time_ms: number;
}

// ── Test definitions based on YAML ──────────────────────────

interface EvalTest {
  id: string;
  category: string;
  query: string;
  intent: string;
  // filter_match: check these strings exist in filters_applied
  expectFilterContains?: string[];
  // sort_match: check this string in filters_applied or verify data ordering
  expectSort?: {
    field: string; // 'volume_24h' | 'price_change_24h' | 'price_usd' | 'relevance'
    order: "DESC" | "ASC";
  };
  // result_consistency: validate each token's data
  dataValidator?: (t: Token) => { pass: boolean; reason: string };
  // noise_check: top N results should match this
  noiseCheck?: (tokens: Token[]) => { pass: boolean; reason: string };
  // For edge cases with flexible criteria
  flexiblePass?: (data: SearchResponse) => { pass: boolean; reason: string };
}

const evalTests: EvalTest[] = [
  // ── BASIC LOOKUP ──
  {
    id: "basic_01",
    category: "basic_lookup",
    query: "BONK",
    intent: "특정 토큰을 이름으로 직접 검색",
    noiseCheck: (tokens) => {
      const top3 = tokens.slice(0, 3);
      const hasBonk = top3.some(t => t.token_base_symbol?.toUpperCase() === "BONK");
      return { pass: hasBonk, reason: hasBonk ? "BONK in top 3" : `Top 3: [${top3.map(t => t.token_base_symbol).join(", ")}] — no BONK` };
    },
  },
  {
    id: "basic_02",
    category: "basic_lookup",
    query: "BONK/SOL raydium",
    intent: "토큰 페어 + DEX 조합으로 검색",
    expectFilterContains: ["raydium"],
    dataValidator: (t) => ({
      pass: (t.dex || "").toLowerCase().includes("raydium"),
      reason: `${t.token_base_symbol} dex=${t.dex}`,
    }),
    noiseCheck: (tokens) => {
      const top3 = tokens.slice(0, 3);
      const allRay = top3.every(t => (t.dex || "").toLowerCase().includes("raydium"));
      return { pass: allRay, reason: allRay ? "all top 3 are Raydium" : `DEXes: [${top3.map(t => t.dex).join(", ")}]` };
    },
  },
  {
    id: "basic_03",
    category: "basic_lookup",
    query: "AwRE12345Fh95abcdefghijklmnopqrstuvwxyz12",
    intent: "컨트랙트 주소로 검색",
    flexiblePass: (data) => ({
      pass: data.tokens.length > 0 || data.search_strategy === "address",
      reason: `${data.tokens.length} results, strategy=${data.search_strategy}`,
    }),
  },

  // ── PRICE FILTER ──
  {
    id: "price_01",
    category: "price_filter",
    query: "tokens under 1$",
    intent: "가격 $1 미만 토큰",
    expectFilterContains: ["price"],
    dataValidator: (t) => ({
      pass: t.price_usd < 1.01,
      reason: `${t.token_base_symbol} price=$${t.price_usd}`,
    }),
  },
  {
    id: "price_02",
    category: "price_filter",
    query: "meme coins under $0.001",
    intent: "밈코인 중 초저가",
    expectFilterContains: ["0.001"],
    dataValidator: (t) => ({
      pass: t.price_usd < 0.0011,
      reason: `${t.token_base_symbol} price=$${t.price_usd}`,
    }),
  },
  {
    id: "price_03",
    category: "price_filter",
    query: "tokens between $1 and $5",
    intent: "가격 레인지 $1-$5",
    expectFilterContains: ["price"],
    dataValidator: (t) => ({
      pass: t.price_usd >= 0.99 && t.price_usd <= 5.01,
      reason: `${t.token_base_symbol} price=$${t.price_usd}`,
    }),
  },

  // ── VOLUME & LIQUIDITY ──
  {
    id: "vol_01",
    category: "volume_liquidity",
    query: "highest volume today",
    intent: "당일 거래량 TOP",
    expectFilterContains: ["volume_24h DESC"],
    expectSort: { field: "volume_24h", order: "DESC" },
  },
  {
    id: "vol_02",
    category: "volume_liquidity",
    query: "tokens with over 1M volume",
    intent: "볼륨 $1M 이상",
    expectFilterContains: ["vol"],
    dataValidator: (t) => ({
      pass: t.volume_24h >= 999_000,
      reason: `${t.token_base_symbol} vol=$${t.volume_24h}`,
    }),
  },
  {
    id: "vol_03",
    category: "volume_liquidity",
    query: "high volume low mcap",
    intent: "볼↑시총↓ 토큰",
    flexiblePass: (data) => ({
      pass: data.tokens.length > 0,
      reason: `${data.tokens.length} results, semantic search working`,
    }),
  },

  // ── MOMENTUM ──
  {
    id: "mom_01",
    category: "momentum",
    query: "top gainers today",
    intent: "당일 상승률 TOP",
    expectFilterContains: ["price_change_24h DESC"],
    expectSort: { field: "price_change_24h", order: "DESC" },
  },
  {
    id: "mom_02",
    category: "momentum",
    query: "biggest losers 24h",
    intent: "24h 하락률 TOP",
    expectFilterContains: ["price_change_24h ASC"],
    expectSort: { field: "price_change_24h", order: "ASC" },
  },
  {
    id: "mom_03",
    category: "momentum",
    query: "tokens up 100% this week",
    intent: "주간 100%+ 상승",
    expectFilterContains: ["100%"],
    dataValidator: (t) => ({
      pass: t.price_change_24h >= 99,
      reason: `${t.token_base_symbol} change=${t.price_change_24h}%`,
    }),
  },

  // ── RECENCY ──
  {
    id: "new_01",
    category: "recency",
    query: "new pairs last hour",
    intent: "최근 1시간 내 생성된 페어",
    expectFilterContains: ["1h"],
  },
  {
    id: "new_02",
    category: "recency",
    query: "launched today",
    intent: "오늘 런칭 토큰",
    expectFilterContains: ["today"],
  },
  {
    id: "new_03",
    category: "recency",
    query: "tokens older than 30 days",
    intent: "30일 이상 된 토큰",
    expectFilterContains: ["30d"],
    dataValidator: (t) => {
      if (!t.pool_created_at) return { pass: true, reason: "no created_at (ok)" };
      const age = Date.now() - new Date(t.pool_created_at).getTime();
      const days = age / (1000 * 60 * 60 * 24);
      return { pass: days >= 29, reason: `${t.token_base_symbol} age=${days.toFixed(0)}d` };
    },
  },

  // ── DEX SPECIFIC ──
  {
    id: "dex_01",
    category: "dex_specific",
    query: "raydium top pairs",
    intent: "Raydium DEX 인기 페어",
    expectFilterContains: ["raydium"],
    dataValidator: (t) => ({
      pass: (t.dex || "").toLowerCase().includes("raydium"),
      reason: `${t.token_base_symbol} dex=${t.dex}`,
    }),
  },
  {
    id: "dex_02",
    category: "dex_specific",
    query: "meteora pools",
    intent: "Meteora DEX 풀",
    expectFilterContains: ["meteora"],
    dataValidator: (t) => ({
      pass: (t.dex || "").toLowerCase().includes("meteora"),
      reason: `${t.token_base_symbol} dex=${t.dex}`,
    }),
  },

  // ── THEMATIC ──
  {
    id: "theme_01",
    category: "thematic",
    query: "trump tokens",
    intent: "트럼프 관련 토큰",
    noiseCheck: (tokens) => {
      const hasTrump = tokens.some(t =>
        (t.token_base_symbol || "").toLowerCase().includes("trump") ||
        (t.token_name || "").toLowerCase().includes("trump")
      );
      return { pass: hasTrump, reason: hasTrump ? "has trump token" : "no trump in results" };
    },
  },
  {
    id: "theme_02",
    category: "thematic",
    query: "AI tokens",
    intent: "AI 내러티브 토큰",
    flexiblePass: (data) => ({
      pass: data.tokens.length > 0 && ["hybrid", "vector", "fts"].includes(data.search_engine),
      reason: `${data.tokens.length} results via ${data.search_engine}`,
    }),
  },
  {
    id: "theme_03",
    category: "thematic",
    query: "dog tokens solana",
    intent: "강아지 밈코인",
    noiseCheck: (tokens) => {
      const dogRelated = ["dog", "doge", "wif", "bonk", "shib", "puppy", "inu"];
      const top5 = tokens.slice(0, 5);
      const hasDog = top5.some(t =>
        dogRelated.some(d =>
          (t.token_base_symbol || "").toLowerCase().includes(d) ||
          (t.token_name || "").toLowerCase().includes(d)
        )
      );
      return { pass: hasDog, reason: hasDog ? "has dog-related token in top 5" : `Top 5: [${top5.map(t => t.token_base_symbol).join(", ")}]` };
    },
  },

  // ── MULTI-FILTER ──
  {
    id: "multi_01",
    category: "multi_filter",
    query: "new meme coins high volume under $0.01",
    intent: "신규+밈+고볼+저가",
    expectFilterContains: ["0.01"],
    dataValidator: (t) => ({
      pass: t.price_usd <= 0.011,
      reason: `${t.token_base_symbol} price=$${t.price_usd}`,
    }),
  },
  {
    id: "multi_02",
    category: "multi_filter",
    query: "raydium gainers over 50% today",
    intent: "DEX + 상승률 + 기간",
    expectFilterContains: ["50%", "raydium"],
  },
  {
    id: "multi_03",
    category: "multi_filter",
    query: "SOL pairs mcap under 500k volume over 100k",
    intent: "시총 + 볼륨 복합",
    expectFilterContains: ["mcap", "vol"],
  },

  // ── NATURAL LANGUAGE ──
  {
    id: "nlp_01",
    category: "natural_language",
    query: "cheap coins",
    intent: "'cheap' = 저가 → price filter 매핑",
    expectFilterContains: ["price"],
  },
  {
    id: "nlp_02",
    category: "natural_language",
    query: "sub penny tokens",
    intent: "'sub penny' = $0.01 미만",
    expectFilterContains: ["0.01"],
    dataValidator: (t) => ({
      pass: t.price_usd <= 0.011,
      reason: `${t.token_base_symbol} price=$${t.price_usd}`,
    }),
  },

  // ── EDGE CASES ──
  {
    id: "edge_01",
    category: "edge_case",
    query: "bnok",
    intent: "오타 BONK → bnok — fuzzy match",
    flexiblePass: (data) => {
      const hasBonk = data.tokens.some(t => t.token_base_symbol?.toUpperCase() === "BONK");
      return { pass: hasBonk || data.tokens.length > 0, reason: hasBonk ? "BONK found via fuzzy" : `${data.tokens.length} results (fuzzy fallback)` };
    },
  },
  {
    id: "edge_02",
    category: "edge_case",
    query: "good tokens",
    intent: "모호한 검색 → fallback",
    flexiblePass: (data) => ({
      pass: data.tokens.length > 0,
      reason: `${data.tokens.length} results via ${data.search_engine}`,
    }),
  },
];

// ── Eval runner ─────────────────────────────────────────────

async function evaluate(test: EvalTest): Promise<EvalResult> {
  const result: EvalResult = {
    id: test.id,
    category: test.category,
    query: test.query,
    intent: test.intent,
    filter_match: 0,
    sort_match: 0,
    result_consistency: 0,
    noise_check: 0,
    score: 0,
    pass: false,
    fail_reasons: [],
    result_count: 0,
    engine: "",
    applied_filters: [],
    query_time_ms: 0,
  };

  try {
    const url = `${BASE_URL}/api/search?q=${encodeURIComponent(test.query)}`;
    const resp = await fetch(url);
    const data: SearchResponse = await resp.json();
    const tokens = data.tokens || [];

    result.result_count = tokens.length;
    result.engine = data.search_engine || "?";
    result.applied_filters = data.filters_applied || [];
    result.query_time_ms = data.query_time_ms || 0;

    // Handle flexible pass (edge cases, semantic)
    if (test.flexiblePass) {
      const fp = test.flexiblePass(data);
      if (fp.pass) {
        result.filter_match = 1;
        result.sort_match = 1;
        result.result_consistency = 1;
        result.noise_check = 1;
      } else {
        result.fail_reasons.push(`flexible: ${fp.reason}`);
      }
      result.score = result.filter_match + result.sort_match + result.result_consistency + result.noise_check;
      result.pass = result.score >= 3;
      return result;
    }

    // 1. FILTER MATCH
    if (test.expectFilterContains) {
      const filtersStr = result.applied_filters.join(" ").toLowerCase();
      const allFound = test.expectFilterContains.every(ef => filtersStr.includes(ef.toLowerCase()));
      if (allFound) {
        result.filter_match = 1;
      } else {
        const missing = test.expectFilterContains.filter(ef => !filtersStr.includes(ef.toLowerCase()));
        result.fail_reasons.push(`filter_match: missing [${missing.join(", ")}] in [${result.applied_filters.join(", ")}]`);
      }
    } else {
      result.filter_match = 1; // no filter expected = auto pass
    }

    // 2. SORT MATCH
    if (test.expectSort) {
      const { field, order } = test.expectSort;
      const sortStr = `${field} ${order}`;
      const filtersStr = result.applied_filters.join(" ").toLowerCase();
      if (filtersStr.includes(sortStr.toLowerCase())) {
        result.sort_match = 1;
      } else {
        // Also check actual data ordering
        let sorted = true;
        for (let i = 1; i < Math.min(tokens.length, 5); i++) {
          const prev = Number(tokens[i - 1][field] ?? 0);
          const curr = Number(tokens[i][field] ?? 0);
          if (order === "DESC" && curr > prev + 0.01) { sorted = false; break; }
          if (order === "ASC" && curr < prev - 0.01) { sorted = false; break; }
        }
        if (sorted && tokens.length > 1) {
          result.sort_match = 1;
        } else {
          result.fail_reasons.push(`sort_match: expected ${sortStr}, filters=[${result.applied_filters.join(", ")}]`);
        }
      }
    } else {
      result.sort_match = 1; // no sort expected = auto pass
    }

    // 3. RESULT CONSISTENCY
    if (test.dataValidator && tokens.length > 0) {
      let failures = 0;
      const failDetails: string[] = [];
      for (const t of tokens) {
        const v = test.dataValidator(t);
        if (!v.pass) {
          failures++;
          failDetails.push(v.reason);
        }
      }
      if (failures === 0) {
        result.result_consistency = 1;
      } else {
        result.fail_reasons.push(`result_consistency: ${failures}/${tokens.length} failed — ${failDetails.slice(0, 3).join("; ")}`);
      }
    } else {
      result.result_consistency = 1; // no data validator or 0 results = auto pass
    }

    // 4. NOISE CHECK
    if (test.noiseCheck) {
      const nc = test.noiseCheck(tokens);
      if (nc.pass) {
        result.noise_check = 1;
      } else {
        result.fail_reasons.push(`noise_check: ${nc.reason}`);
      }
    } else {
      result.noise_check = 1; // no noise check = auto pass
    }

    result.score = result.filter_match + result.sort_match + result.result_consistency + result.noise_check;
    result.pass = result.score >= 3;
  } catch (err) {
    result.fail_reasons.push(`ERROR: ${err}`);
  }

  return result;
}

async function main() {
  console.log(`\n\x1b[1mCHAINSCOPE Search Quality Eval\x1b[0m`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Tests: ${evalTests.length} | Passing threshold: 3/4`);
  console.log("═".repeat(90));

  // Check connectivity
  try { await fetch(`${BASE_URL}/api/search?q=test`); }
  catch { console.error(`Cannot reach ${BASE_URL}`); process.exit(1); }

  const results: EvalResult[] = [];

  for (const test of evalTests) {
    const r = await evaluate(test);
    results.push(r);

    const scoreBar = [
      r.filter_match ? "\x1b[32mF\x1b[0m" : "\x1b[31mF\x1b[0m",
      r.sort_match ? "\x1b[32mS\x1b[0m" : "\x1b[31mS\x1b[0m",
      r.result_consistency ? "\x1b[32mR\x1b[0m" : "\x1b[31mR\x1b[0m",
      r.noise_check ? "\x1b[32mN\x1b[0m" : "\x1b[31mN\x1b[0m",
    ].join("");

    const status = r.pass ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
    console.log(`${status} [${scoreBar}] ${r.score}/4 | ${r.id.padEnd(10)} | ${r.result_count}r ${r.engine.padEnd(8)} | ${r.query}`);
    if (r.fail_reasons.length > 0) {
      for (const fr of r.fail_reasons.slice(0, 2)) {
        console.log(`     \x1b[31m→ ${fr}\x1b[0m`);
      }
    }
  }

  // ── Summary ──
  console.log("\n" + "═".repeat(90));

  // Category breakdown
  const categories = [...new Set(results.map(r => r.category))];
  console.log("\n\x1b[1mCategory Scores:\x1b[0m\n");
  for (const cat of categories) {
    const catResults = results.filter(r => r.category === cat);
    const avgScore = catResults.reduce((s, r) => s + r.score, 0) / catResults.length;
    const passCount = catResults.filter(r => r.pass).length;
    const bar = avgScore >= 3.5 ? "🟢" : avgScore >= 2.5 ? "🟡" : "🔴";
    console.log(`  ${bar} ${cat.padEnd(20)} avg=${avgScore.toFixed(1)}/4  pass=${passCount}/${catResults.length}`);
  }

  const totalPass = results.filter(r => r.pass).length;
  const totalScore = results.reduce((s, r) => s + r.score, 0);
  const avgScore = totalScore / results.length;

  console.log(`\n\x1b[1mOverall:\x1b[0m`);
  console.log(`  Pass: ${totalPass}/${results.length} (${(totalPass / results.length * 100).toFixed(0)}%)`);
  console.log(`  Avg score: ${avgScore.toFixed(2)}/4`);
  console.log(`  Total score: ${totalScore}/${results.length * 4}`);

  if (results.some(r => !r.pass)) {
    console.log(`\n\x1b[1m\x1b[31mFailed tests:\x1b[0m`);
    for (const r of results.filter(r => !r.pass)) {
      console.log(`  ${r.id} "${r.query}" (${r.score}/4)`);
      for (const fr of r.fail_reasons) {
        console.log(`    → ${fr}`);
      }
    }
  }

  // ── Save JSON report ──
  const report = {
    meta: { base_url: BASE_URL, timestamp: new Date().toISOString(), total_tests: results.length, pass_threshold: 3 },
    summary: { total_pass: totalPass, total_fail: results.length - totalPass, avg_score: avgScore, pass_rate: totalPass / results.length },
    category_scores: Object.fromEntries(categories.map(cat => {
      const cr = results.filter(r => r.category === cat);
      return [cat, { avg: cr.reduce((s, r) => s + r.score, 0) / cr.length, pass: cr.filter(r => r.pass).length, total: cr.length }];
    })),
    results,
  };

  const fs = await import("fs");
  const reportPath = "/Users/minjea.seo@pingcap.com/Documents/chainscope_search_research/eval_report.json";
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nReport saved: ${reportPath}`);

  process.exit(results.some(r => !r.pass) ? 1 : 0);
}

main();
