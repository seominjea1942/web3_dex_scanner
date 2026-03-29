"use client";

import { useState, useRef, useCallback, useMemo } from "react";
import { useBreakpoint } from "@/hooks/useBreakpoint";
import { formatCompact } from "@/lib/format";
import { SchemaPanel } from "./SchemaPanel";
import { QueryChips, getPresetInfo } from "./QueryChips";
import { ResultsChart } from "./ResultsChart";

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
  const regex = /('(?:[^'\\]|\\.)*')|(\b\d+(?:\.\d+)?\b)|(--[^\n]*)|(\b[A-Za-z_]\w*\b)|(\s+)|(.)/g;
  let match;
  let key = 0;

  while ((match = regex.exec(sql)) !== null) {
    const [, str, num, comment, word, ws, sym] = match;
    if (str) {
      parts.push(<span key={key++} style={{ color: "var(--sql-string)" }}>{str}</span>);
    } else if (num) {
      parts.push(<span key={key++} style={{ color: "var(--sql-number)" }}>{num}</span>);
    } else if (comment) {
      parts.push(<span key={key++} style={{ color: "var(--sql-comment)" }}>{comment}</span>);
    } else if (word) {
      const upper = word.toUpperCase();
      if (SQL_KEYWORDS.has(upper)) {
        parts.push(<span key={key++} style={{ color: "var(--sql-keyword)", fontWeight: 600 }}>{word.toUpperCase()}</span>);
      } else if (SQL_FUNCTIONS.has(upper)) {
        parts.push(<span key={key++} style={{ color: "var(--sql-function)" }}>{word}</span>);
      } else if (word === word.toUpperCase() && word.length > 1) {
        parts.push(<span key={key++} style={{ color: "var(--text-primary)" }}>{word}</span>);
      } else {
        parts.push(<span key={key++} style={{ color: "var(--sql-identifier)" }}>{word}</span>);
      }
    } else if (ws) {
      parts.push(<span key={key++}>{ws}</span>);
    } else if (sym) {
      parts.push(<span key={key++} style={{ color: "var(--text-muted)" }}>{sym}</span>);
    }
  }

  return parts;
}

// ── Placeholder table columns for empty state ───────────────────
const PLACEHOLDER_COLS = ["token_address", "pair_name", "total_volume", "trade_count", "avg_price"];
const PLACEHOLDER_WIDTHS = [140, 100, 110, 90, 100];

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
  const isMobile = bp === "mobile";
  const [sql, setSql] = useState("");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const executeQuery = useCallback(async (query: string, presetId?: string | null) => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/sql/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql: query, presetId: presetId ?? null }),
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

  const handleInsertText = useCallback((text: string) => {
    const ta = textareaRef.current;
    if (!ta) {
      setSql((prev) => prev + (prev && !prev.endsWith(" ") ? " " : "") + text);
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const before = sql.slice(0, start);
    const after = sql.slice(end);
    const space = before && !before.endsWith(" ") && !before.endsWith("\n") ? " " : "";
    const newSql = before + space + text + after;
    setSql(newSql);
    setActivePreset(null);
    requestAnimationFrame(() => {
      const pos = start + space.length + text.length;
      ta.setSelectionRange(pos, pos);
      ta.focus();
    });
  }, [sql]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      executeQuery(sql, activePreset);
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "l") {
      e.preventDefault();
      setSql("");
      setResult(null);
      setError(null);
      setActivePreset(null);
    }
  }, [sql, activePreset, executeQuery]);

  const handlePresetSelect = useCallback((id: string, presetSql: string) => {
    setSql(presetSql);
    setActivePreset(id);
    setResult(null);
    setError(null);
  }, []);

  const handleClear = useCallback(() => {
    setSql("");
    setResult(null);
    setError(null);
    setActivePreset(null);
  }, []);

  const highlighted = useMemo(() => highlightSql(sql), [sql]);
  const lines = sql.split("\n");
  const presetInfo = activePreset ? getPresetInfo(activePreset) : null;

  return (
    <div className="flex-1 overflow-y-auto pb-16" style={{ background: "var(--bg-primary)" }}>
      <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-4">

        {/* ── Page Title (aligned with DEX Screener header) ──── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined" style={{ fontSize: 16, color: "var(--accent-teal)" }}>terminal</span>
            <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              Explore the data yourself
            </span>
            <span className="text-xs hidden md:inline" style={{ color: "var(--text-muted)" }}>
              &mdash; query 7M+ rows on TiDB
            </span>
          </div>
          <div className="text-xs hidden sm:block" style={{ color: "var(--text-muted)" }}>
            Cmd+Enter to run &middot; Cmd+L to clear
          </div>
        </div>

        {/* ── Preset Query Chips ─────────────────────────────── */}
        <QueryChips
          activePreset={activePreset}
          onSelect={handlePresetSelect}
          onClear={handleClear}
          disabled={loading}
          onSchemaToggle={isMobile ? () => setSidebarOpen(true) : undefined}
        />

        {/* ── Query Description Bar ─────────────────────────── */}
        {presetInfo && (
          <div
            className="flex items-start gap-2 px-3 py-2 rounded-lg text-xs"
            style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}
          >
            <span
              className="material-symbols-outlined shrink-0 mt-px"
              style={{ fontSize: 14, color: presetInfo.color }}
            >
              {presetInfo.icon}
            </span>
            <span style={{ color: "var(--text-secondary)", lineHeight: 1.5 }}>
              {presetInfo.description}
            </span>
          </div>
        )}

        {/* ═══ ROW 1: Schema + SQL Editor side by side ═══════ */}
        <div className={`flex items-stretch gap-4 ${isMobile ? "flex-col" : ""}`} style={{ height: isMobile ? undefined : 380 }}>
          {/* Schema Panel */}
          {!isMobile && (
            <div
              className="shrink-0 rounded-lg border overflow-hidden flex flex-col"
              style={{
                width: 252,
                borderColor: "var(--border)",
                background: "var(--bg-secondary)",
              }}
            >
              <SchemaPanel onInsertText={handleInsertText} />
            </div>
          )}

          {/* Mobile sidebar overlay */}
          {isMobile && sidebarOpen && (
            <div className="fixed inset-0 z-50 flex">
              <div
                className="absolute inset-0"
                style={{ background: "rgba(0,0,0,0.5)" }}
                onClick={() => setSidebarOpen(false)}
              />
              <div
                className="relative w-72 overflow-y-auto animate-fade-in"
                style={{ background: "var(--bg-secondary)" }}
              >
                <SchemaPanel onInsertText={(t) => { handleInsertText(t); setSidebarOpen(false); }} />
              </div>
            </div>
          )}

          {/* SQL Editor — stretches to fill row height */}
          <div className="flex-1 min-w-0 flex flex-col">
            <div
              className="relative rounded-lg border overflow-hidden flex flex-col flex-1"
              style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
            >
              {/* Line numbers + highlighted code */}
              <div
                className="flex flex-1 overflow-auto"
                style={{ backgroundImage: "linear-gradient(to right, var(--bg-secondary) 40px, transparent 40px)" }}
              >
                {/* Line number gutter */}
                <div
                  className="shrink-0 pt-3 pb-3 text-right select-none font-mono text-xs"
                  style={{
                    width: 40,
                    color: "var(--text-muted)",
                    background: "var(--bg-secondary)",
                    borderRight: "1px solid var(--border)",
                    paddingRight: 8,
                    paddingLeft: 4,
                  }}
                >
                  {(sql || " ").split("\n").map((_, i) => (
                    <div key={i} style={{ lineHeight: "1.625", height: "1.625em" }}>{i + 1}</div>
                  ))}
                </div>

                {/* Editor area */}
                <div className="relative flex-1 min-w-0">
                  <pre
                    className="font-mono text-sm pt-3 pb-3 pl-3 pr-3 pointer-events-none whitespace-pre-wrap break-words"
                    style={{ lineHeight: "1.625", margin: 0, color: "transparent" }}
                    aria-hidden
                  >
                    {sql ? highlighted : (
                      <span style={{ color: "var(--text-muted)" }}>SELECT * FROM swap_transactions LIMIT 10;</span>
                    )}
                    {"\n"}
                  </pre>
                  <textarea
                    ref={textareaRef}
                    value={sql}
                    onChange={(e) => { setSql(e.target.value); setActivePreset(null); }}
                    onKeyDown={handleKeyDown}
                    className="absolute inset-0 w-full h-full font-mono text-sm pt-3 pb-3 pl-3 pr-3 resize-none focus:outline-none"
                    style={{
                      background: "transparent",
                      color: "transparent",
                      caretColor: "var(--text-primary)",
                      lineHeight: "1.625",
                    }}
                    spellCheck={false}
                  />
                </div>
              </div>

              {/* Run button bar — always at bottom */}
              <div
                className="flex items-center justify-between px-3 py-2 border-t"
                style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}
              >
                <div className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>
                  {lines.length} line{lines.length > 1 ? "s" : ""}
                </div>
                <button
                  onClick={() => executeQuery(sql, activePreset)}
                  disabled={loading || !sql.trim()}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium transition-all"
                  style={{
                    background: loading || !sql.trim() ? "var(--bg-hover)" : "var(--accent-blue)",
                    color: loading || !sql.trim() ? "var(--text-muted)" : "#fff",
                    opacity: loading ? 0.7 : 1,
                  }}
                >
                  {loading ? (
                    <span className="material-symbols-outlined animate-spin" style={{ fontSize: 14 }}>progress_activity</span>
                  ) : (
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>play_arrow</span>
                  )}
                  {loading ? "running..." : "Run"}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ═══ ROW 2: Results (full width below) ═════════════ */}

        {/* Execution Metadata */}
        {result && (
          <div
            className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 px-4 py-2 rounded-lg text-xs font-mono"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}
          >
            <span style={{ color: "var(--text-secondary)" }}>
              Query{" "}
              <span style={{ color: "var(--accent-green)" }}>{result.executionTimeMs}ms</span>
              <span
                className="material-symbols-outlined"
                title="Server-side query time — includes network travel to TiDB Cloud Singapore. Actual TiDB execution is a fraction of this."
                style={{ fontSize: 11, verticalAlign: "middle", marginLeft: 3, cursor: "help", color: "var(--text-muted)" }}
              >info</span>
              {" · "}
              <span style={{ color: "var(--text-primary)" }}>{result.rowCount.toLocaleString()}</span> rows returned
            </span>
            <a
              href="https://www.pingcap.com/tidb-essential/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 no-underline hover:underline shrink-0"
              style={{ color: "var(--accent-teal)" }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 13 }}>bolt</span>
              Powered by TiDB Essential
            </a>
          </div>
        )}

        {/* Error State */}
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

        {/* Results Panel */}
        {result && (
          <div>
            {/* Results header */}
            <div
              className="flex items-center px-4 py-3 rounded-t-lg border border-b-0"
              style={{
                background: "var(--bg-hover)",
                borderColor: "var(--border)",
              }}
            >
              <div className="flex items-center gap-2.5">
                <span className="material-symbols-outlined" style={{ fontSize: 16, color: "var(--accent-teal)" }}>table_chart</span>
                <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                  Query Results
                </span>
                <span
                  className="px-2 py-0.5 rounded-full text-[10px] font-mono font-medium"
                  style={{ background: "var(--accent-teal)", color: "#fff" }}
                >
                  {result.rowCount.toLocaleString()} rows
                </span>
              </div>
            </div>

            {/* Results body — table */}
            <div
              className="border overflow-hidden"
              style={{ borderColor: "var(--border)" }}
            >
              {result.rows.length === 0 ? (
                <div className="p-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                  No results returned
                </div>
              ) : (
                <div className="overflow-auto" style={{ maxHeight: isMobile ? 320 : 10 * 37 + 37 }}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ background: "var(--bg-secondary)" }}>
                        {result.columns.map((col) => (
                          <th
                            key={col}
                            className="text-left px-3 py-2.5 font-semibold text-xs uppercase tracking-wide whitespace-nowrap border-b sticky top-0"
                            style={{ color: "var(--text-primary)", borderColor: "var(--border)", background: "var(--bg-secondary)" }}
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
                </div>
              )}
            </div>

            {/* Chart — always shown below table */}
            {result.rows.length > 0 && (
              <div
                className="rounded-b-lg border border-t-0 p-4"
                style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}
              >
                <ResultsChart columns={result.columns} rows={result.rows} presetId={activePreset} />
              </div>
            )}
          </div>
        )}

        {/* ── Empty state with table placeholder ─────────────── */}
        {!result && !error && !loading && (
          <div
            className="rounded-lg border overflow-hidden"
            style={{ borderColor: "var(--border)" }}
          >
            {/* Header bar — matches active result header style */}
            <div
              className="flex items-center px-4 py-3 border-b"
              style={{ background: "var(--bg-hover)", borderColor: "var(--border)" }}
            >
              <div className="flex items-center gap-2.5">
                <span className="material-symbols-outlined" style={{ fontSize: 16, color: "var(--text-muted)" }}>table_chart</span>
                <span className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
                  Query Results
                </span>
                <span
                  className="px-2 py-0.5 rounded-full text-[10px] font-mono font-medium"
                  style={{ background: "var(--bg-card)", color: "var(--text-muted)", border: "1px solid var(--border)" }}
                >
                  0 rows
                </span>
              </div>
            </div>

            {/* Placeholder table skeleton */}
            <div className="overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: "var(--bg-card)" }}>
                    {PLACEHOLDER_COLS.map((col, i) => (
                      <th
                        key={col}
                        className="text-left px-3 py-2.5 font-medium text-xs whitespace-nowrap border-b"
                        style={{ color: "var(--text-muted)", borderColor: "var(--border)", width: PLACEHOLDER_WIDTHS[i] }}
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 5 }).map((_, rowIdx) => (
                    <tr
                      key={rowIdx}
                      style={{ background: rowIdx % 2 === 0 ? "var(--bg-primary)" : "var(--bg-card)" }}
                    >
                      {PLACEHOLDER_WIDTHS.map((w, colIdx) => (
                        <td
                          key={colIdx}
                          className="px-3 py-2.5 border-b"
                          style={{ borderColor: "var(--border)" }}
                        >
                          <div
                            className="rounded"
                            style={{
                              height: 12,
                              width: w * (0.5 + Math.random() * 0.4),
                              background: "var(--bg-hover)",
                              opacity: 0.6 - rowIdx * 0.08,
                            }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Overlay message */}
              <div
                className="flex flex-col items-center justify-center py-8 -mt-32 relative z-10"
                style={{ background: "linear-gradient(transparent, var(--bg-primary) 40%)" }}
              >
                <span className="material-symbols-outlined mb-2" style={{ fontSize: 36, color: "var(--text-muted)", opacity: 0.4 }}>terminal</span>
                <div className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>Run a query to see results</div>
                <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>Pick a preset above, or write your own SQL</div>
              </div>
            </div>
          </div>
        )}

      </div>
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
      <span style={{ color: str === "buy" ? "var(--accent-green)" : "var(--accent-red)" }}>
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
