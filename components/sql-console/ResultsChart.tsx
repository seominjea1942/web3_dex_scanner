"use client";

import { useMemo } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { formatCompact } from "@/lib/format";

// ── Types ────────────────────────────────────────────────────────
export interface ChartHint {
  /** "bar" | "horizontal_bar" | "line" | "none" */
  type: "bar" | "horizontal_bar" | "line" | "none";
  /** Column to use as category/x-axis */
  xKey: string;
  /** Columns to chart (limit to 1-2 for clarity) */
  yKeys: string[];
  /** Optional: build xKey by concatenating multiple columns */
  xConcat?: string[];
  /** Optional: sort data by this column descending before charting */
  sortBy?: string;
}

/**
 * Chart hints per preset query id.
 * Tells the chart exactly what to show instead of guessing.
 */
export const PRESET_CHART_HINTS: Record<string, ChartHint> = {
  // Whale trades — horizontal bar ranked by usd_value
  whale: {
    type: "horizontal_bar",
    xKey: "trader_wallet",
    yKeys: ["usd_value"],
    sortBy: "usd_value",
  },
  // Volume by DEX — clean single-metric bar
  realtime_agg: {
    type: "bar",
    xKey: "dex",
    yKeys: ["total_volume"],
  },
  // Wallet ranking — horizontal bar of top wallets by volume
  window_fn: {
    type: "horizontal_bar",
    xKey: "_wallet",
    yKeys: ["total_volume"],
    xConcat: ["label", "address"],
    sortBy: "total_volume",
  },
  // Hottest pools — bar with pair label
  hottest: {
    type: "bar",
    xKey: "_pair",
    yKeys: ["volume"],
    xConcat: ["token_base_symbol", "token_quote_symbol"],
  },
  // Search events — table only, chart doesn't help
  search_events: {
    type: "none",
    xKey: "",
    yKeys: [],
  },
  // Smart money — horizontal bar by wallet
  smart_money: {
    type: "horizontal_bar",
    xKey: "_wallet",
    yKeys: ["total_volume"],
    xConcat: ["label", "address"],
    sortBy: "total_volume",
  },
  // Price OHLCV — line chart of avg_close + volume
  time_series: {
    type: "line",
    xKey: "day",
    yKeys: ["avg_close"],
    sortBy: "day",
  },
};

interface ResultsChartProps {
  columns: string[];
  rows: Record<string, unknown>[];
  presetId?: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────
const TIMESTAMP_PATTERNS = /time|date|hour|day|month/i;
const MAX_DATA_POINTS = 30;

const COLORS = [
  "#818CF8", // purple
  "#30D158", // green
  "#FF9F0A", // orange
  "#FF4259", // red
  "#64D2FF", // cyan
  "#BF5AF2", // magenta
];

function isNumeric(value: unknown): boolean {
  if (typeof value === "number") return true;
  if (typeof value === "string" && value.trim() !== "") return !isNaN(Number(value));
  return false;
}

function toNumber(value: unknown): number {
  return Number(value);
}

function classifyColumns(
  columns: string[],
  firstRow: Record<string, unknown>
) {
  const numeric: string[] = [];
  const label: string[] = [];
  const timestamp: string[] = [];

  for (const col of columns) {
    const isTs = TIMESTAMP_PATTERNS.test(col);
    const val = firstRow[col];
    const isNum = isNumeric(val);

    if (isTs) timestamp.push(col);
    else if (isNum) numeric.push(col);
    else label.push(col);
  }

  return { numeric, label, timestamp };
}

const tooltipStyle = {
  contentStyle: {
    background: "#1A1A1A",
    border: "1px solid #222222",
    borderRadius: 8,
    color: "#EDEDED",
    fontSize: 12,
  },
  itemStyle: { color: "#EDEDED" },
  labelStyle: { color: "#EDEDED", fontWeight: 600, marginBottom: 4 },
};

const axisTickStyle = { fill: "#888888", fontSize: 11 };

function formatTickValue(value: unknown): string {
  if (typeof value === "number") return formatCompact(value);
  return String(value);
}

function shortenWallet(s: string): string {
  if (s && s.length > 10) return s.slice(0, 4) + "…" + s.slice(-4);
  return s;
}

function shortenLabel(s: string, max = 14): string {
  if (!s) return "";
  return s.length > max ? s.slice(0, max) + "…" : s;
}

// ── Component ────────────────────────────────────────────────────
export function ResultsChart({ columns, rows, presetId }: ResultsChartProps) {
  const chartConfig = useMemo(() => {
    if (!rows.length || !columns.length) return null;

    const hint = presetId ? PRESET_CHART_HINTS[presetId] : undefined;

    // ── Hinted chart ──
    if (hint) {
      if (hint.type === "none") return null;

      let data = rows.slice(0, MAX_DATA_POINTS).map((row) => {
        const entry: Record<string, unknown> = {};
        for (const col of columns) {
          const val = row[col];
          entry[col] = isNumeric(val) ? toNumber(val) : val;
        }
        // Build concatenated x-key if needed
        if (hint.xConcat && hint.xConcat.length > 0) {
          const parts = hint.xConcat.map((c) => {
            const v = String(row[c] ?? "");
            // Shorten wallet-like strings (base58, 32+ chars)
            return v.length > 20 ? v.slice(0, 4) + "…" + v.slice(-4) : v;
          });
          // Use " · " for label+address, " / " for token pairs
          const sep = hint.xKey === "_wallet" ? " · " : " / ";
          entry[hint.xKey] = parts.filter(Boolean).join(sep);
        }
        return entry;
      });

      // Sort if specified (ascending for line charts, descending for bars)
      if (hint.sortBy) {
        const dir = hint.type === "line" ? 1 : -1;
        data.sort((a, b) => {
          const av = toNumber(a[hint.sortBy!]);
          const bv = toNumber(b[hint.sortBy!]);
          return (av - bv) * dir;
        });
      }

      return {
        type: hint.type,
        xKey: hint.xKey,
        yKeys: hint.yKeys,
        data,
      };
    }

    // ── Auto-detect (fallback for custom queries) ──
    const { numeric, label, timestamp } = classifyColumns(columns, rows[0]);

    const data = rows.slice(0, MAX_DATA_POINTS).map((row) => {
      const entry: Record<string, unknown> = {};
      for (const col of columns) {
        const val = row[col];
        entry[col] = isNumeric(val) && !TIMESTAMP_PATTERNS.test(col) ? toNumber(val) : val;
      }
      return entry;
    });

    if (timestamp.length > 0 && numeric.length > 0) {
      return { type: "line" as const, xKey: timestamp[0], yKeys: numeric.slice(0, 2), data };
    }
    if (label.length > 0 && numeric.length > 0) {
      return { type: "bar" as const, xKey: label[0], yKeys: numeric.slice(0, 2), data };
    }
    return null;
  }, [columns, rows, presetId]);

  if (!chartConfig) {
    return (
      <div
        style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", height: 160, gap: 8,
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 32, color: "var(--text-muted)", opacity: 0.4 }}>
          table_chart
        </span>
        <span style={{ color: "var(--text-muted)", fontSize: 12, textAlign: "center" }}>
          Results displayed as table only
        </span>
      </div>
    );
  }

  const { type, xKey, yKeys, data } = chartConfig;

  // ── Horizontal Bar (whale trades, rankings) ────────────────
  if (type === "horizontal_bar") {
    const chartHeight = Math.max(250, data.length * 36 + 40);
    return (
      <div style={{ width: "100%", height: chartHeight }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
            <CartesianGrid stroke="#222222" strokeDasharray="3 3" strokeOpacity={0.3} horizontal={false} />
            <YAxis
              dataKey={xKey}
              type="category"
              width={60}
              tick={axisTickStyle}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => shortenWallet(String(v))}
            />
            <XAxis
              type="number"
              tick={axisTickStyle}
              tickLine={false}
              axisLine={{ stroke: "#222222" }}
              tickFormatter={(v) => formatTickValue(v)}
            />
            <Tooltip
              contentStyle={tooltipStyle.contentStyle}
              itemStyle={tooltipStyle.itemStyle}
              labelStyle={tooltipStyle.labelStyle}
              formatter={(value: number, name: string) => ["$" + formatCompact(value), name]}
              labelFormatter={(v) => String(v)}
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
            />
            {yKeys.map((key, idx) => (
              <Bar
                key={key}
                dataKey={key}
                fill={COLORS[idx]}
                radius={[0, 4, 4, 0]}
                name={key}
                barSize={20}
              >
                {data.map((_, entryIdx) => (
                  <Cell key={entryIdx} fill={COLORS[idx]} opacity={0.85} />
                ))}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // ── Line Chart ─────────────────────────────────────────────
  if (type === "line") {
    const lineMinWidth = Math.max(data.length * 40 + 80, 300);
    return (
      <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
        <div style={{ width: "100%", minWidth: lineMinWidth, height: 300 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="#222222" strokeDasharray="3 3" strokeOpacity={0.3} />
            <XAxis
              dataKey={xKey}
              tick={axisTickStyle}
              tickLine={false}
              axisLine={{ stroke: "#222222" }}
              tickFormatter={(v) => {
                const s = String(v);
                if (s.length > 16) return s.slice(5, 16);
                return s;
              }}
            />
            <YAxis
              width={50}
              tick={axisTickStyle}
              tickLine={false}
              axisLine={{ stroke: "#222222" }}
              tickFormatter={(v) => formatTickValue(v)}
            />
            <Tooltip
              contentStyle={tooltipStyle.contentStyle}
              itemStyle={tooltipStyle.itemStyle}
              labelStyle={tooltipStyle.labelStyle}
              formatter={(value: number, name: string) => [formatCompact(value), name]}
            />
            {yKeys.map((key, idx) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={COLORS[idx]}
                strokeWidth={2}
                dot={{ r: 3, fill: COLORS[idx], stroke: COLORS[idx] }}
                activeDot={{ r: 5, stroke: COLORS[idx] }}
                name={key}
              />
            ))}
          </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

  // ── Vertical Bar Chart ─────────────────────────────────────
  const barMinWidth = Math.max(data.length * 70 + 80, 300);
  return (
    <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
      <div style={{ width: "100%", minWidth: barMinWidth, height: 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="#222222" strokeDasharray="3 3" strokeOpacity={0.3} />
            <XAxis
              dataKey={xKey}
              tick={{ ...axisTickStyle, fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: "#222222" }}
              tickFormatter={(v) => shortenLabel(String(v), 12)}
              angle={-35}
              textAnchor="end"
              height={40}
            />
            <YAxis
              width={50}
              tick={axisTickStyle}
              tickLine={false}
              axisLine={{ stroke: "#222222" }}
              tickFormatter={(v) => formatTickValue(v)}
            />
            <Tooltip
              contentStyle={tooltipStyle.contentStyle}
              itemStyle={tooltipStyle.itemStyle}
              labelStyle={tooltipStyle.labelStyle}
              formatter={(value: number, name: string) => ["$" + formatCompact(value), name]}
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
            />
            {yKeys.map((key, idx) => (
              <Bar
                key={key}
                dataKey={key}
                radius={[4, 4, 0, 0] as unknown as number}
                name={key}
                fill={COLORS[idx]}
                barSize={32}
              >
                {data.map((_, entryIdx) => (
                  <Cell key={entryIdx} fill={COLORS[idx]} opacity={0.85} />
                ))}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
