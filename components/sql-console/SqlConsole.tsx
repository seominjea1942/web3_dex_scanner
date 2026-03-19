"use client";

import { useState, useRef, useCallback, useMemo } from "react";
import { useBreakpoint } from "@/hooks/useBreakpoint";
import { formatCompact } from "@/lib/format";
import { SchemaPanel } from "./SchemaPanel";
import { QueryChips } from "./QueryChips";
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
      parts.push(<span key={key++} style={{ color: "#E9967A" }}>{str}</span>);
    } else if (num) {
      parts.push(<span key={key++} style={{ color: "#B5CEA8" }}>{num}</span>);
    } else if (comment) {
      parts.push(<span key={key++} style={{ color: "#6A9955" }}>{comment}</span>);
    } else if (word) {
      const upper = word.toUpperCase();
      if (SQL_KEYWORDS.has(upper)) {
        parts.push(<span key={key++} style={{ color: "#569CD6", fontWeight: 600 }}>{word.toUpperCase()}</span>);
      } else if (SQL_FUNCTIONS.has(upper)) {
        parts.push(<span key={key++} style={{ color: "#DCDCAA" }}>{word}</span>);
      } else if (word === word.toUpperCase() && word.length > 1) {
        parts.push(<span key={key++} style={{ color: "var(--text-primary)" }}>{word}</span>);
      } else {
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
  const [resultView, setResultView] = useState<"table" | "chart">("table");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const executeQuery = useCallback(async (query: string) => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setResultView("table");
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
    // Restore cursor after insert
    requestAnimationFrame(() => {
      const pos = start + space.length + text.length;
      ta.setSelectionRange(pos, pos);
      ta.focus();
    });
  }, [sql]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      executeQuery(sql);
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "l") {
      e.preventDefault();
      setSql("");
      setResult(null);
      setError(null);
      setActivePreset(null);
    }
  }, [sql, executeQuery]);

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

  return (
    <div className="flex flex-1 min-h-0" style={{ background: "var(--bg-primary)" }}>
      {/* ── Schema Sidebar (desktop) ─────────────────────────── */}
      {!isMobile && (
        <div
          className="shrink-0 border-r overflow-y-auto"
          style={{
            width: 252,
            borderColor: "var(--border)",
            background: "var(--bg-secondary)",
          }}
        >
          <SchemaPanel onInsertText={handleInsertText} />
        </div>
      )}

      {/* ── Mobile sidebar overlay ───────────────────────────── */}
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

      {/* ── Main Content ─────────────────────────────────────── */}
      <div className="flex-1 min-w-0 overflow-y-auto pb-16">
        <div className="p-4 md:p-6 max-w-[1200px] mx-auto space-y-4">
          {/* Page Title */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {isMobile && (
                <button
                  onClick={() => setSidebarOpen(true)}
                  className="flex items-center justify-center w-8 h-8 rounded-lg"
                  style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18, color: "var(--text-secondary)" }}>menu</span>
                </button>
              )}
              <h1 className="font-mono text-lg md:text-xl font-bold" style={{ color: "var(--text-primary)" }}>
                <span style={{ color: "var(--accent-teal)" }}>&gt;_</span> sql console
              </h1>
            </div>
            <div className="text-xs hidden sm:block" style={{ color: "var(--text-muted)" }}>
              {isMobile ? "" : "Cmd+Enter to run · Cmd+L to clear"}
            </div>
          </div>

          {/* Preset Query Chips */}
          <QueryChips
            activePreset={activePreset}
            onSelect={handlePresetSelect}
            onClear={handleClear}
            disabled={loading}
          />

          {/* ── SQL Editor ───────────────────────────────────── */}
          <div>
            <div
              className="relative rounded-lg border overflow-hidden"
              style={{ background: "#1E1E1E", borderColor: "var(--border)" }}
            >
              {/* Line numbers + highlighted code */}
              <div className="flex" style={{ minHeight: isMobile ? 120 : 180 }}>
                {/* Line number gutter */}
                <div
                  className="shrink-0 py-3 text-right select-none font-mono text-xs leading-relaxed"
                  style={{
                    width: 40,
                    color: "var(--text-muted)",
                    background: "rgba(255,255,255,0.02)",
                    borderRight: "1px solid var(--border)",
                    paddingRight: 8,
                    paddingLeft: 4,
                  }}
                >
                  {(sql || " ").split("\n").map((_, i) => (
                    <div key={i} style={{ lineHeight: "1.6" }}>{i + 1}</div>
                  ))}
                </div>

                {/* Editor area */}
                <div className="relative flex-1 min-w-0">
                  <pre
                    className="font-mono text-sm p-3 pointer-events-none whitespace-pre-wrap break-words"
                    style={{ lineHeight: 1.6, margin: 0, color: "transparent" }}
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
                    className="absolute inset-0 w-full h-full font-mono text-sm p-3 resize-none focus:outline-none"
                    style={{
                      background: "transparent",
                      color: "transparent",
                      caretColor: "var(--text-primary)",
                      lineHeight: 1.6,
                    }}
                    spellCheck={false}
                  />
                </div>
              </div>

              {/* Run button bar inside editor */}
              <div
                className="flex items-center justify-between px-3 py-2 border-t"
                style={{ borderColor: "var(--border)", background: "rgba(255,255,255,0.02)" }}
              >
                <div className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>
                  {lines.length} line{lines.length > 1 ? "s" : ""}
                </div>
                <button
                  onClick={() => executeQuery(sql)}
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
                  {loading ? "running..." : "\u25B6 run"}
                </button>
              </div>
            </div>
          </div>

          {/* ── Execution Metadata ───────────────────────────── */}
          {result && (
            <div
              className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 rounded-lg text-xs font-mono"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}
            >
              <span style={{ color: "var(--text-secondary)" }}>
                Query completed in{" "}
                <span style={{ color: "var(--accent-green)" }}>{result.executionTimeMs}ms</span>
              </span>
              <span style={{ color: "var(--text-muted)" }}>&middot;</span>
              <span style={{ color: "var(--text-secondary)" }}>
                <span style={{ color: "var(--text-primary)" }}>{result.rowCount.toLocaleString()}</span> rows returned
              </span>
              <span className="ml-auto flex items-center gap-1" style={{ color: "var(--accent-teal)" }}>
                <span className="material-symbols-outlined" style={{ fontSize: 13 }}>bolt</span>
                TiDB Essential
              </span>
            </div>
          )}

          {/* ── Error State ──────────────────────────────────── */}
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

          {/* ── Results Panel ────────────────────────────────── */}
          {result && (
            <div>
              {/* Results header */}
              <div
                className="flex items-center justify-between px-4 py-2.5 rounded-t-lg border border-b-0"
                style={{ background: "var(--bg-hover)", borderColor: "var(--border)" }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-medium uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                    Query Results
                  </span>
                  <span
                    className="px-2 py-0.5 rounded-full text-[10px] font-mono font-medium"
                    style={{ background: "var(--bg-card)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
                  >
                    {result.rowCount.toLocaleString()} rows
                  </span>
                </div>
                <div className="flex items-center rounded-md overflow-hidden border" style={{ borderColor: "var(--border)" }}>
                  <button
                    onClick={() => setResultView("table")}
                    className="flex items-center gap-1 px-3 py-1 text-xs font-medium transition-colors"
                    style={{
                      background: resultView === "table" ? "var(--bg-card)" : "transparent",
                      color: resultView === "table" ? "var(--text-primary)" : "var(--text-muted)",
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>table_rows</span>
                    Table
                  </button>
                  <button
                    onClick={() => setResultView("chart")}
                    className="flex items-center gap-1 px-3 py-1 text-xs font-medium transition-colors"
                    style={{
                      background: resultView === "chart" ? "var(--bg-card)" : "transparent",
                      color: resultView === "chart" ? "var(--text-primary)" : "var(--text-muted)",
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>bar_chart</span>
                    Chart
                  </button>
                </div>
              </div>

              {/* Results body */}
              <div
                className="rounded-b-lg border overflow-hidden"
                style={{ borderColor: "var(--border)" }}
              >
                {resultView === "chart" ? (
                  <div className="p-4" style={{ background: "var(--bg-primary)" }}>
                    <ResultsChart columns={result.columns} rows={result.rows} />
                  </div>
                ) : result.rows.length === 0 ? (
                  <div className="p-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                    No results returned
                  </div>
                ) : (
                  <div className="overflow-x-auto" style={{ maxHeight: isMobile ? 400 : 500 }}>
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ background: "var(--bg-card)" }}>
                          {result.columns.map((col) => (
                            <th
                              key={col}
                              className="text-left px-3 py-2.5 font-medium text-xs whitespace-nowrap border-b sticky top-0"
                              style={{ color: "var(--text-secondary)", borderColor: "var(--border)", background: "var(--bg-card)" }}
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
            </div>
          )}

          {/* ── Empty state ──────────────────────────────────── */}
          {!result && !error && !loading && (
            <div className="py-16 text-center" style={{ color: "var(--text-muted)" }}>
              <span className="material-symbols-outlined mb-3 block" style={{ fontSize: 48, opacity: 0.2 }}>terminal</span>
              <div className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>Run a query to see results</div>
              <div className="text-xs mt-1">Pick a preset above, or write your own SQL in the editor</div>
            </div>
          )}
        </div>
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
