"use client";

import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface DualAxisChartProps {
  data: Array<Record<string, number | string>>;
  leftKey: string;
  rightKey: string;
  leftColor: string;
  rightColor: string;
  leftLabel: string;
  rightLabel: string;
}

export function DualAxisChart({
  data,
  leftKey,
  rightKey,
  leftColor,
  rightColor,
  leftLabel,
  rightLabel,
}: DualAxisChartProps) {
  if (data.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-xs" style={{ color: "var(--text-muted)" }}>
        Loading chart data...
      </div>
    );
  }

  // Sample data to max ~60 points for performance
  const sampled = data.length > 60
    ? data.filter((_, i) => i % Math.ceil(data.length / 60) === 0)
    : data;

  return (
    <ResponsiveContainer width="100%" height={200}>
      <ComposedChart data={sampled} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
        <defs>
          <linearGradient id={`grad-${leftKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={leftColor} stopOpacity={0.2} />
            <stop offset="95%" stopColor={leftColor} stopOpacity={0} />
          </linearGradient>
        </defs>

        <XAxis
          dataKey="time"
          tick={{ fill: "var(--text-muted)", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          yAxisId="left"
          tick={{ fill: leftColor, fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          width={40}
          tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          tick={{ fill: rightColor, fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          width={30}
          tickFormatter={(v: number) => `${v}ms`}
        />

        <Tooltip
          contentStyle={{
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            fontSize: "12px",
            color: "var(--text-primary)",
          }}
          labelStyle={{ color: "var(--text-muted)" }}
        />

        <Legend
          wrapperStyle={{ fontSize: "10px", color: "var(--text-muted)" }}
          iconType="line"
        />

        <Area
          yAxisId="left"
          type="monotone"
          dataKey={leftKey}
          stroke={leftColor}
          fill={`url(#grad-${leftKey})`}
          strokeWidth={1.5}
          name={leftLabel}
          dot={false}
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey={rightKey}
          stroke={rightColor}
          strokeWidth={1.5}
          dot={false}
          name={rightLabel}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
