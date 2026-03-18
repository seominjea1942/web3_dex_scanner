"use client";

import { useState, useRef, useCallback, useMemo } from "react";
import { useBreakpoint } from "@/hooks/useBreakpoint";
import { formatCompact } from "@/lib/format";

// ── SQL Syntax Highlighting ─────────────────────────────────────
const SQL_KEYWORDS = new Set([
  "SELECT", "FROM", "WHERE", "AND", "OR", "NOT", "IN", "AS", "ON",
  "JOIN", "LEFT", "RIGHT", "INNER", "OUTER", "CROSS", "FULL",
  "GROUP", "BY", "ORDER", "HAVING", "LIMIT", "OFFSET", "UNION",
  "INSERT", "INTO", "VALUES", "UPDATE", "SET", "DELETE",
  "CREATE", "TABLE", "DROP", "ALTER", "INDEX",
  "DISTINCT", "ALL", "EXISTS", "BETWEEN", "LIKE", "IS", "NULL",
  "CASE", "WHEN", "THEN", "ELSE", "END", "IF",
  "ASC", "DESC", "WITH", "INTERVAL", "TRUE", "FALSE",
]);

const SQL_FUNCTIONS = new Set([
  "COUNT", "SUM", "AVG", "MIN", "MAX", "ROUND", "FLOOR", "CEIL",
  "COALESCE", "GREATEST", "LEAST", "CONCAT", "SUBSTRING",
  "NOW", "UNIX_TIMESTAMP", "FROM_UNIXTIME", "DATE_FORMAT",
  "TIMESTAMPDIFF", "MATCH", "AGAINST",
]);

function highlightSql(sql: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // Tokenize: strings, numbers, words, symbols, whitespace
  const regex = /('(?:[^'\\]|\\.)*')|(\b\d+(?:\.\d+)?\b)|(--[^\n]*)|(\b[A-Za-z_]\w*\b)|(\s+)|(.)/g;
  let match;
  let key = 0;

  while ((match = regex.exec(sql)) !== null) {
    const [, str, num, comment, word, ws, sym] = match;
    if (str) {
      // String literal
      parts.push(<span key={key++} style={{ color: "#E9967A" }}>{str}</span>);
    } else if (num) {
      // Number
      parts.push(<span key={key++} style={{ color: "#B5CEA8" }}>{num}</span>);
    } else if (comment) {
      // Comment
      parts.push(<span key={key++} style={{ color: "#6A9955" }}>{comment}</span>);
    } else if (word) {
      const upper = word.toUpperCase();
      if (SQL_KEYWORDS.has(upper)) {
        parts.push(<span key={key++} style={{ color: "#569CD6", fontWeight: 600 }}>{word.toUpperCase()}</span>);
      } else if (SQL_FUNCTIONS.has(upper)) {
        parts.push(<span key={key++} style={{ color: "#DCDCAA" }}>{word}</span>);
      } else if (word === word.toUpperCase() && word.length > 1) {
        // ALL_CAPS identifiers like table aliases
        parts.push(<span key={key++} style={{ color: "var(--text-primary)" }}>{word}</span>);
      } else {
        // Regular identifiers
        parts.push(<span key={key++} style={{ color: "#9CDCFE" }}>{word}</span>);
      }
    } else if (ws) {
      parts.push(<span key={key++}>{ws}</span>);
    } else if (sym) {
      parts.push(<span key={key++} style={{ color: "var(--text-muted)" }}>{sym}</span>);
    }
  }

  return parts;
}

// ── Preset Queries ──────────────────────────────────────────────
const PRESET_QUERIES = [
  {
    id: "whale",
    title: "Top Whale Trades",
    description: "Largest trades in the last 24 hours",
    icon: "waves",
    color: "var(--accent-blue)",
    sql: `SELECT t.signature, t.trader_wallet, t.usd_value,
       t.side, p.token_base_symbol, p.token_quote_symbol, p.dex,
       FROM_UNIXTIME(t.timestamp / 1000) AS trade_time
FROM swap_transactions t
JOIN pools p ON t.pool_address = p.address
WHERE t.timestamp > (UNIX_TIMESTAMP() - 86400) * 1000
  AND t.usd_value > 10000
ORDER BY t.usd_value DESC
LIMIT 20`,
  },
  {
    id: "smart_money",
    title: "Smart Money Wallets",
    description: "Wallets with high buy ratio this week",
    icon: "diamond",
    color: "var(--accent-teal)",
    sql: `SELECT trader_wallet,
       COUNT(*) AS total_trades,
       SUM(CASE WHEN side = 'buy' THEN 1 ELSE 0 END) AS buys,
       SUM(CASE WHEN side = 'sell' THEN 1 ELSE 0 END) AS sells,
       ROUND(SUM(usd_value), 2) AS total_volume
FROM swap_transactions
WHERE timestamp > (UNIX_TIMESTAMP() - 7 * 86400) * 1000
GROUP BY trader_wallet
HAVING total_trades >= 10 AND buys > sells * 2
ORDER BY total_volume DESC
LIMIT 20`,
  },
  {
    id: "volume_dex",
    title: "Volume by DEX",
    description: "Compare trading volume across DEXes (7 days)",
    icon: "bar_chart",
    color: "var(--accent-green)",
    sql: `SELECT p.dex,
       COUNT(*) AS trade_count,
       ROUND(SUM(t.usd_value), 2) AS total_volume,
       COUNT(DISTINCT t.trader_wallet) AS unique_wallets
FROM swap_transactions t
JOIN pools p ON t.pool_address = p.address
WHERE t.timestamp > (UNIX_TIMESTAMP() - 7 * 86400) * 1000
GROUP BY p.dex
ORDER BY total_volume DESC`,
  },
  {
    id: "hottest",
    title: "Hottest Pools",
    description: "Most active pools in the last hour",
    icon: "local_fire_department",
    color: "var(--accent-orange)",
    sql: `SELECT p.token_base_symbol, p.token_quote_symbol, p.dex,
       COUNT(*) AS tx_count,
       ROUND(SUM(t.usd_value), 2) AS volume,
       COUNT(DISTINCT t.trader_wallet) AS traders
FROM swap_transactions t
JOIN pools p ON t.pool_address = p.address
WHERE t.timestamp > (UNIX_TIMESTAMP() - 3600) * 1000
GROUP BY t.pool_address, p.token_base_symbol, p.token_quote_symbol, p.dex
ORDER BY tx_count DESC
LIMIT 15`,
  },
  {
    id: "search_events",
    title: "Search Events",
    description: "Search event descriptions for keywords",
    icon: "search",
    color: "var(--accent-purple, #A855F7)",
    sql: `SELECT event_type, severity, dex, usd_value,
       description,
       FROM_UNIXTIME(timestamp / 1000) AS event_time
FROM defi_events
WHERE description LIKE '%whale%'
ORDER BY timestamp DESC
LIMIT 20`,
  },
  {
    id: "dumpers",
    title: "Top Dumpers",
    description: "Wallets with heavy sell pressure (24h)",
    icon: "trending_down",
    color: "var(--accent-red, #EF4444)",
    sql: `SELECT trader_wallet,
       COUNT(*) AS sell_count,
       ROUND(SUM(usd_value), 2) AS total_sold
FROM swap_transactions
WHERE side = 'sell'
  AND timestamp > (UNIX_TIMESTAMP() - 86400) * 1000
GROUP BY trader_wallet
ORDER BY total_sold DESC
LIMIT 20`,
  },
  {
    id: "tx_over_time",
    title: "TX Volume Over Time",
    description: "Hourly transaction volume (24h)",
    icon: "timeline",
    color: "var(--accent-green)",
    sql: `SELECT FROM_UNIXTIME(FLOOR(timestamp / 3600000) * 3600) AS hour,
       COUNT(*) AS tx_count,
       ROUND(SUM(usd_value), 2) AS volume
FROM swap_transactions
WHERE timestamp > (UNIX_TIMESTAMP() - 86400) * 1000
GROUP BY FLOOR(timestamp / 3600000)
ORDER BY hour DESC`,
  },
];

// ── Types ───────────────────────────────────────────────────────
interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  executionTimeMs: number;
}

// ── Main Component ──────────────────────────────────────────────
export function SqlConsole() {
  const bp = useBreakpoint();
  const [sql, setSql] = useState("");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const executeQuery = useCallback(async (query: string) => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/sql/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql: query }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Query failed");
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Query failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const handlePresetClick = useCallback((preset: typeof PRESET_QUERIES[0]) => {
    setSql(preset.sql);
    setActivePreset(preset.id);
    setResult(null);
    setError(null);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      executeQuery(sql);
    }
  }, [sql, executeQuery]);

  const highlighted = useMemo(() => highlightSql(sql), [sql]);
  const gridCols = bp === "mobile" ? "grid-cols-1" : bp === "tablet" ? "grid-cols-3" : "grid-cols-4";

  return (
    <div className="p-4 md:p-6 pb-16 max-w-[1400px] mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined" style={{ fontSize: 24, color: "var(--accent-teal)" }}>terminal</span>
        <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>SQL Console</h1>
        <span className="text-sm ml-2" style={{ color: "var(--text-muted)" }}>
          Query 7M+ rows on TiDB Essential
        </span>
      </div>

      {/* Preset Query Buttons */}
      <div>
        <div className="text-xs font-medium mb-2" style={{ color: "var(--text-secondary)" }}>Quick Queries</div>
        <div className={`grid gap-2 ${gridCols}`}>
          {PRESET_QUERIES.map((preset) => (
            <button
              key={preset.id}
              onClick={() => handlePresetClick(preset)}
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-left transition-all"
              style={{
                background: activePreset === preset.id ? "var(--bg-hover)" : "var(--bg-card)",
                borderColor: activePreset === preset.id ? preset.color : "var(--border)",
                opacity: loading ? 0.6 : 1,
              }}
              disabled={loading}
            >
              <span
                className="material-symbols-outlined shrink-0"
                style={{ fontSize: 18, color: preset.color }}
              >
                {preset.icon}
              </span>
              <div className="min-w-0">
                <div className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>
                  {preset.title}
                </div>
                <div className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                  {preset.description}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* SQL Editor */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>SQL Query</div>
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>
            {bp === "mobile" ? "Run ▶" : "⌘+Enter to run"}
          </div>
        </div>
        <div
          className="relative rounded-lg border overflow-hidden"
          style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
        >
          {/* Syntax-highlighted layer (behind textarea) */}
          <pre
            className="font-mono text-sm p-4 pointer-events-none whitespace-pre-wrap break-words"
            style={{
              minHeight: bp === "mobile" ? 100 : 140,
              lineHeight: 1.6,
              margin: 0,
              color: "transparent",
            }}
            aria-hidden
          >
            {sql ? highlighted : (
              <span style={{ color: "var(--text-muted)" }}>Enter SQL query... (SELECT only)</span>
            )}
            {/* Extra newline so pre matches textarea scroll height */}
            {"\n"}
          </pre>
          {/* Transparent textarea on top for editing */}
          <textarea
            ref={textareaRef}
            value={sql}
            onChange={(e) => {
              setSql(e.target.value);
              setActivePreset(null);
            }}
            onKeyDown={handleKeyDown}
            className="absolute inset-0 w-full h-full font-mono text-sm p-4 resize-none focus:outline-none"
            style={{
              background: "transparent",
              color: "transparent",
              caretColor: "var(--text-primary)",
              lineHeight: 1.6,
            }}
            spellCheck={false}
          />
        </div>
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => executeQuery(sql)}
            disabled={loading || !sql.trim()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all"
            style={{
              background: loading || !sql.trim() ? "var(--bg-hover)" : "var(--accent-blue, #6366F1)",
              color: loading || !sql.trim() ? "var(--text-muted)" : "#fff",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? (
              <span className="material-symbols-outlined animate-spin" style={{ fontSize: 16 }}>progress_activity</span>
            ) : (
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>play_arrow</span>
            )}
            {loading ? "Running..." : "Run Query"}
          </button>
          {sql && (
            <button
              onClick={() => { setSql(""); setResult(null); setError(null); setActivePreset(null); }}
              className="px-3 py-2 rounded-lg text-sm transition-colors"
              style={{ color: "var(--text-muted)" }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div
          className="rounded-lg border p-4 text-sm font-mono"
          style={{
            background: "rgba(239, 68, 68, 0.08)",
            borderColor: "rgba(239, 68, 68, 0.3)",
            color: "#EF4444",
          }}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>error</span>
            <span className="font-medium font-sans">Query Error</span>
          </div>
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <div>
          {/* Stats Bar */}
          <div
            className="flex items-center gap-4 px-4 py-2.5 rounded-t-lg border border-b-0 text-xs"
            style={{ background: "var(--bg-hover)", borderColor: "var(--border)" }}
          >
            <div style={{ color: "var(--text-secondary)" }}>
              Returned <span className="font-mono font-medium" style={{ color: "var(--text-primary)" }}>
                {result.rowCount.toLocaleString()}
              </span> rows
            </div>
            <div style={{ color: "var(--text-secondary)" }}>
              in <span className="font-mono font-medium" style={{ color: "var(--accent-green)" }}>
                {result.executionTimeMs}ms
              </span>
            </div>
            <div className="ml-auto flex items-center gap-1.5" style={{ color: "var(--accent-teal)" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>bolt</span>
              TiDB Essential
            </div>
          </div>

          {/* Results Table */}
          <div
            className="rounded-b-lg border overflow-x-auto"
            style={{ borderColor: "var(--border)", maxHeight: bp === "mobile" ? 400 : 500 }}
          >
            {result.rows.length === 0 ? (
              <div className="p-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                No results returned
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: "var(--bg-card)" }}>
                    {result.columns.map((col) => (
                      <th
                        key={col}
                        className="text-left px-3 py-2.5 font-medium text-xs whitespace-nowrap border-b"
                        style={{ color: "var(--text-secondary)", borderColor: "var(--border)" }}
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, i) => (
                    <tr
                      key={i}
                      className="transition-colors"
                      style={{ background: i % 2 === 0 ? "var(--bg-primary)" : "var(--bg-card)" }}
                    >
                      {result.columns.map((col) => (
                        <td
                          key={col}
                          className="px-3 py-2 whitespace-nowrap border-b font-mono text-xs"
                          style={{ color: "var(--text-primary)", borderColor: "var(--border)" }}
                        >
                          <CellValue value={row[col]} column={col} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!result && !error && !loading && (
        <div className="py-12 text-center" style={{ color: "var(--text-muted)" }}>
          <span className="material-symbols-outlined mb-2" style={{ fontSize: 40, opacity: 0.3 }}>database</span>
          <div className="text-sm">Click a quick query or write your own SQL above</div>
          <div className="text-xs mt-1">7M+ swap transactions · 1,300+ pools · 600+ tokens</div>
        </div>
      )}
    </div>
  );
}

// ── Cell Value Renderer ─────────────────────────────────────────
function CellValue({ value, column }: { value: unknown; column: string }) {
  if (value === null || value === undefined) {
    return <span style={{ color: "var(--text-muted)" }}>NULL</span>;
  }

  const str = String(value);
  const colLower = column.toLowerCase();

  // USD values
  if (colLower.includes("usd") || colLower.includes("volume") || colLower.includes("sold") || colLower.includes("total_volume")) {
    const num = Number(value);
    if (!isNaN(num)) {
      return <span style={{ color: "var(--accent-green)" }}>${formatCompact(num)}</span>;
    }
  }

  // Wallet addresses
  if (colLower.includes("wallet") || colLower.includes("address")) {
    if (str.length > 12) {
      return <span title={str}>{str.slice(0, 4)}...{str.slice(-4)}</span>;
    }
  }

  // Signature/hash
  if (colLower === "signature" || colLower.includes("hash")) {
    if (str.length > 16) {
      return <span title={str}>{str.slice(0, 6)}...{str.slice(-4)}</span>;
    }
  }

  // Side (buy/sell)
  if (colLower === "side") {
    return (
      <span style={{ color: str === "buy" ? "var(--accent-green)" : "var(--accent-red, #EF4444)" }}>
        {str}
      </span>
    );
  }

  // Numbers
  if (typeof value === "number" || (typeof value === "string" && !isNaN(Number(value)) && value.trim() !== "")) {
    const num = Number(value);
    if (Number.isInteger(num) && num > 1000) {
      return <>{num.toLocaleString()}</>;
    }
  }

  return <>{str}</>;
}
