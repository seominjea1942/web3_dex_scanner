"use client";

import { useState, useEffect, useCallback, useMemo } from "react";

// ── Types ────────────────────────────────────────────────────────
interface Column {
  name: string;
  type: string;
  key: string;
}

interface Table {
  name: string;
  columns: Column[];
}

interface SchemaResponse {
  database: string;
  tables: Table[];
  table_count: number;
  view_count: number;
}

interface SchemaPanelProps {
  onInsertText: (text: string) => void;
}

// ── Type Badge Mapping ───────────────────────────────────────────
function getTypeBadge(type: string, key: string): { label: string; color: string } {
  if (key === "PRI") return { label: "PK", color: "var(--accent-teal)" };
  const lower = type.toLowerCase();
  if (lower.includes("timestamp") || lower.includes("datetime") || lower.includes("date"))
    return { label: "TS", color: "var(--accent-orange)" };
  if (lower.includes("varchar") || lower.includes("text") || lower.includes("char"))
    return { label: "VC", color: "var(--accent-purple)" };
  if (lower.includes("decimal") || lower.includes("double") || lower.includes("float"))
    return { label: "DC", color: "var(--accent-green)" };
  if (lower.includes("bigint"))
    return { label: "BIG", color: "var(--accent-blue)" };
  if (lower.includes("int"))
    return { label: "INT", color: "var(--accent-blue)" };
  if (lower.includes("enum"))
    return { label: "ENUM", color: "var(--accent-orange)" };
  if (lower.includes("bool") || lower.includes("tinyint(1)"))
    return { label: "BOOL", color: "var(--accent-green)" };
  if (lower.includes("json"))
    return { label: "JSON", color: "var(--accent-purple)" };
  if (lower.includes("blob") || lower.includes("binary"))
    return { label: "BIN", color: "var(--text-secondary)" };
  return { label: "?", color: "var(--text-muted)" };
}

// ── Component ────────────────────────────────────────────────────
export function SchemaPanel({ onInsertText }: SchemaPanelProps) {
  const [schema, setSchema] = useState<SchemaResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");

  const fetchSchema = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/schema");
      const data: SchemaResponse = await res.json();
      setSchema(data);
      // Expand the first table by default
      if (data.tables.length > 0 && expanded.size === 0) {
        setExpanded(new Set([data.tables[0].name]));
      }
    } catch {
      // silently fail — panel just stays empty
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchSchema();
  }, [fetchSchema]);

  const toggleTable = useCallback((name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const filteredTables = useMemo(() => {
    if (!schema) return [];
    if (!filter.trim()) return schema.tables;
    const q = filter.toLowerCase();
    return schema.tables.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.columns.some((c) => c.name.toLowerCase().includes(q))
    );
  }, [schema, filter]);

  return (
    <div
      style={{
        width: "100%",
        flex: 1,
        minHeight: 0,
        background: "var(--bg-secondary)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 12px 8px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.05em",
            color: "var(--text-muted)",
            textTransform: "uppercase" as const,
          }}
        >
          Schema
        </span>
        <button
          onClick={fetchSchema}
          disabled={loading}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 2,
            display: "flex",
            alignItems: "center",
            color: "var(--text-muted)",
            opacity: loading ? 0.5 : 1,
          }}
          title="Refresh schema"
        >
          <span
            className="material-symbols-outlined"
            style={{
              fontSize: 16,
              animation: loading ? "spin 1s linear infinite" : undefined,
            }}
          >
            refresh
          </span>
        </button>
      </div>

      {/* Database name */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 12px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span
          className="material-symbols-outlined"
          style={{ fontSize: 16, color: "var(--accent-teal)" }}
        >
          database
        </span>
        <span
          className="font-mono"
          style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}
        >
          {schema?.database ?? "chainscope"}
        </span>
      </div>

      {/* Search */}
      <div style={{ padding: "8px 12px" }}>
        <input
          type="text"
          placeholder="Filter tables..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            width: "100%",
            padding: "6px 8px",
            fontSize: 12,
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "var(--bg-card)",
            color: "var(--text-primary)",
            outline: "none",
          }}
        />
      </div>

      {/* Table list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 0 8px" }}>
        {loading && !schema ? (
          <div
            style={{
              padding: 16,
              textAlign: "center",
              fontSize: 12,
              color: "var(--text-muted)",
            }}
          >
            Loading schema...
          </div>
        ) : filteredTables.length === 0 ? (
          <div
            style={{
              padding: 16,
              textAlign: "center",
              fontSize: 12,
              color: "var(--text-muted)",
            }}
          >
            No tables found
          </div>
        ) : (
          filteredTables.map((table) => {
            const isExpanded = expanded.has(table.name);
            return (
              <div key={table.name}>
                {/* Table row */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "5px 12px",
                    cursor: "pointer",
                    fontSize: 12,
                    color: "var(--text-primary)",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "var(--bg-hover)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                  onClick={() => toggleTable(table.name)}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{
                      fontSize: 14,
                      color: "var(--text-muted)",
                      transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                      transition: "transform 0.15s",
                    }}
                  >
                    chevron_right
                  </span>
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 14, color: "var(--text-secondary)" }}
                  >
                    grid_on
                  </span>
                  <span
                    className="font-mono"
                    style={{
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onInsertText(table.name);
                    }}
                    title={`Click to insert "${table.name}"`}
                  >
                    {table.name}
                  </span>
                </div>

                {/* Columns */}
                {isExpanded && (
                  <div style={{ paddingLeft: 20 }}>
                    {table.columns.map((col) => {
                      const badge = getTypeBadge(col.type, col.key);
                      return (
                        <div
                          key={col.name}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "3px 12px",
                            cursor: "pointer",
                            fontSize: 11,
                            transition: "background 0.15s",
                          }}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.background = "var(--bg-hover)")
                          }
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.background = "transparent")
                          }
                          onClick={() => onInsertText(col.name)}
                          title={`Click to insert "${col.name}"`}
                        >
                          <span
                            style={{
                              display: "inline-block",
                              padding: "1px 4px",
                              borderRadius: 3,
                              fontSize: 9,
                              fontWeight: 700,
                              lineHeight: "14px",
                              letterSpacing: "0.02em",
                              color: "#fff",
                              background: badge.color,
                              minWidth: 22,
                              textAlign: "center",
                              flexShrink: 0,
                            }}
                          >
                            {badge.label}
                          </span>
                          <span
                            className="font-mono"
                            style={{
                              color: "var(--text-primary)",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {col.name}
                          </span>
                          <span
                            style={{
                              color: "var(--text-muted)",
                              fontSize: 10,
                              marginLeft: "auto",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              maxWidth: "50%",
                              textAlign: "right",
                              flexShrink: 1,
                            }}
                            title={col.type}
                          >
                            {col.type}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div
        className="font-mono"
        style={{
          padding: "8px 12px",
          borderTop: "1px solid var(--border)",
          fontSize: 12,
          color: "var(--text-muted)",
          textAlign: "center",
        }}
      >
        tables: {schema?.table_count ?? 0} &middot; views: {schema?.view_count ?? 0}
      </div>
    </div>
  );
}
