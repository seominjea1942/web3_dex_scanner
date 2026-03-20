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
interface ResultsChartProps {
  columns: string[];
  rows: Record<string, unknown>[];
}

// ── Helpers ──────────────────────────────────────────────────────
const TIMESTAMP_PATTERNS = /time|date|hour|day|month/i;
const MAX_DATA_POINTS = 30;

const PRIMARY_COLOR = "#818CF8"; // var(--accent-teal)
const SECONDARY_COLOR = "#30D158"; // var(--accent-green)

function isNumeric(value: unknown): boolean {
  if (typeof value === "number") return true;
  if (typeof value === "string" && value.trim() !== "") return !isNaN(Number(value));
  return false;
}

function toNumber(value: unknown): number {
  return Number(value);
}

interface ColumnClassification {
  numeric: string[];
  label: string[];
  timestamp: string[];
}

function classifyColumns(
  columns: string[],
  firstRow: Record<string, unknown>
): ColumnClassification {
  const numeric: string[] = [];
  const label: string[] = [];
  const timestamp: string[] = [];

  for (const col of columns) {
    const isTs = TIMESTAMP_PATTERNS.test(col);
    const val = firstRow[col];
    const isNum = isNumeric(val);

    if (isTs) {
      timestamp.push(col);
    } else if (isNum) {
      numeric.push(col);
    } else {
      label.push(col);
    }
  }

  return { numeric, label, timestamp };
}

// Custom tooltip styling
const tooltipStyle = {
  contentStyle: {
    background: "#1A1A1A", // var(--bg-card)
    border: "1px solid #222222", // var(--border)
    borderRadius: 8,
    color: "#EDEDED", // var(--text-primary)
    fontSize: 12,
  },
  itemStyle: {
    color: "#EDEDED",
  },
  labelStyle: {
    color: "#EDEDED",
    fontWeight: 600,
    marginBottom: 4,
  },
};

const axisTickStyle = {
  fill: "#555555", // var(--text-muted)
  fontSize: 11,
};

// Format tick values: compact large numbers, pass strings through
function formatTickValue(value: unknown): string {
  if (typeof value === "number") return formatCompact(value);
  return String(value);
}

// ── Component ────────────────────────────────────────────────────
export function ResultsChart({ columns, rows }: ResultsChartProps) {
  const chartConfig = useMemo(() => {
    if (!rows.length || !columns.length) return null;

    const { numeric, label, timestamp } = classifyColumns(columns, rows[0]);

    // Prepare data (limit to MAX_DATA_POINTS)
    const data = rows.slice(0, MAX_DATA_POINTS).map((row) => {
      const entry: Record<string, unknown> = {};
      for (const col of columns) {
        const val = row[col];
        entry[col] = isNumeric(val) && !TIMESTAMP_PATTERNS.test(col) ? toNumber(val) : val;
      }
      return entry;
    });

    // Timestamp + numeric -> LineChart
    if (timestamp.length > 0 && numeric.length > 0) {
      return {
        type: "line" as const,
        xKey: timestamp[0],
        yKeys: numeric,
        data,
      };
    }

    // Label + numeric -> BarChart
    if (label.length > 0 && numeric.length > 0) {
      return {
        type: "bar" as const,
        xKey: label[0],
        yKeys: numeric,
        data,
      };
    }

    return null;
  }, [columns, rows]);

  // Fallback: can't auto-chart
  if (!chartConfig) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: 200,
          gap: 8,
        }}
      >
        <span
          className="material-symbols-outlined"
          style={{ fontSize: 36, color: "var(--text-muted)", opacity: 0.5 }}
        >
          insert_chart
        </span>
        <span style={{ color: "var(--text-muted)", fontSize: 13, textAlign: "center", maxWidth: 360 }}>
          This result set can&apos;t be auto-charted. Try a query with numeric + categorical columns.
        </span>
      </div>
    );
  }

  const { type, xKey, yKeys, data } = chartConfig;

  // ── Line Chart ───────────────────────────────────────────────
  if (type === "line") {
    return (
      <div style={{ width: "100%", height: 350 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
            <CartesianGrid stroke="#222222" strokeDasharray="3 3" strokeOpacity={0.4} />
            <XAxis
              dataKey={xKey}
              tick={axisTickStyle}
              tickLine={false}
              axisLine={{ stroke: "#222222" }}
              tickFormatter={(v) => {
                // Shorten timestamp labels
                const s = String(v);
                if (s.length > 16) return s.slice(5, 16);
                return s;
              }}
            />
            <YAxis
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
                stroke={idx === 0 ? PRIMARY_COLOR : SECONDARY_COLOR}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, stroke: idx === 0 ? PRIMARY_COLOR : SECONDARY_COLOR }}
                name={key}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // ── Bar Chart ────────────────────────────────────────────────
  return (
    <div style={{ width: "100%", height: 350 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
          <CartesianGrid stroke="#222222" strokeDasharray="3 3" strokeOpacity={0.4} />
          <XAxis
            dataKey={xKey}
            tick={axisTickStyle}
            tickLine={false}
            axisLine={{ stroke: "#222222" }}
            tickFormatter={(v) => {
              const s = String(v);
              return s.length > 14 ? s.slice(0, 14) + "\u2026" : s;
            }}
          />
          <YAxis
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
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
          />
          {yKeys.map((key, idx) => (
            <Bar
              key={key}
              dataKey={key}
              radius={[4, 4, 0, 0] as unknown as number}
              name={key}
              fill={idx === 0 ? PRIMARY_COLOR : SECONDARY_COLOR}
            >
              {data.map((_, entryIdx) => (
                <Cell
                  key={entryIdx}
                  fill={idx === 0 ? PRIMARY_COLOR : SECONDARY_COLOR}
                />
              ))}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
