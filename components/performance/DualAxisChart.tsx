"use client";

import { useState, useCallback } from "react";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
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

/* ── Custom Tooltip ────────────────────────────────────── */
function CustomTooltip({
  active,
  payload,
  label,
  leftKey,
  rightKey,
  leftColor,
  rightColor,
  leftLabel,
  rightLabel,
  hidden,
}: {
  active?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any[];
  label?: string;
  leftKey: string;
  rightKey: string;
  leftColor: string;
  rightColor: string;
  leftLabel: string;
  rightLabel: string;
  hidden: Set<string>;
}) {
  if (!active || !payload || payload.length === 0) return null;

  const dataPoint = payload[0]?.payload ?? {};
  const leftVal = dataPoint[leftKey];
  const rightVal = dataPoint[rightKey];

  return (
    <div
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "8px 12px",
        fontSize: 12,
        boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
      }}
    >
      <div style={{ color: "var(--text-muted)", marginBottom: 4, fontSize: 11 }}>
        {label}
      </div>
      {!hidden.has(leftKey) && leftVal != null && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: leftColor,
              display: "inline-block",
              flexShrink: 0,
            }}
          />
          <span style={{ color: "var(--text-secondary)" }}>{leftLabel}:</span>
          <span style={{ color: "var(--text-primary)", fontWeight: 600, fontFamily: "var(--font-mono, monospace)" }}>
            {Number(leftVal).toLocaleString()}
          </span>
        </div>
      )}
      {!hidden.has(rightKey) && rightVal != null && (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: rightColor,
              display: "inline-block",
              flexShrink: 0,
            }}
          />
          <span style={{ color: "var(--text-secondary)" }}>{rightLabel}:</span>
          <span style={{ color: "var(--text-primary)", fontWeight: 600, fontFamily: "var(--font-mono, monospace)" }}>
            {Number(rightVal).toFixed(1)} ms
          </span>
        </div>
      )}
    </div>
  );
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
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const toggleSeries = useCallback((key: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  if (data.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-xs" style={{ color: "var(--text-muted)" }}>
        Loading chart data...
      </div>
    );
  }

  // Compute left y-axis domain with ~20% padding (auto-scale for dramatic spikes)
  const leftValues = data.map((d) => Number(d[leftKey]) || 0);
  const leftMin = Math.min(...leftValues);
  const leftMax = Math.max(...leftValues);
  const leftPad = (leftMax - leftMin) * 0.2 || leftMax * 0.1;

  // Right y-axis (latency): FIXED 0–10ms scale so latency looks flat
  // This is the core HTAP visual — latency barely moves while writes spike

  return (
    <div>
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={data} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
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
            domain={[Math.max(0, Math.floor(leftMin - leftPad)), Math.ceil(leftMax + leftPad)]}
            tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fill: rightColor, fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={35}
            domain={[0, 10]}
            ticks={[0, 2, 4, 6, 8, 10]}
            tickFormatter={(v: number) => `${v}ms`}
          />

          <Tooltip
            cursor={{ stroke: "rgba(255, 255, 255, 0.15)", strokeWidth: 1 }}
            content={
              <CustomTooltip
                leftKey={leftKey}
                rightKey={rightKey}
                leftColor={leftColor}
                rightColor={rightColor}
                leftLabel={leftLabel}
                rightLabel={rightLabel}
                hidden={hidden}
              />
            }
          />

          {!hidden.has(leftKey) && (
            <Area
              yAxisId="left"
              type="monotone"
              dataKey={leftKey}
              stroke={leftColor}
              fill={`url(#grad-${leftKey})`}
              strokeWidth={1.5}
              name={leftLabel}
              dot={false}
              isAnimationActive={false}
            />
          )}
          {!hidden.has(rightKey) && (
            <Line
              yAxisId="right"
              type="monotone"
              dataKey={rightKey}
              stroke={rightColor}
              strokeWidth={1.5}
              dot={false}
              name={rightLabel}
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>

      {/* Custom clickable legend */}
      <div className="flex items-center justify-center gap-4 mt-1">
        <button
          onClick={() => toggleSeries(leftKey)}
          className="flex items-center gap-1.5 text-[10px] cursor-pointer hover:opacity-80 transition-opacity"
          style={{
            color: hidden.has(leftKey) ? "var(--text-muted)" : leftColor,
            textDecoration: hidden.has(leftKey) ? "line-through" : "none",
            opacity: hidden.has(leftKey) ? 0.5 : 1,
            background: "none",
            border: "none",
            padding: 0,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: hidden.has(leftKey) ? "var(--text-muted)" : leftColor,
              display: "inline-block",
            }}
          />
          {leftLabel}
        </button>
        <button
          onClick={() => toggleSeries(rightKey)}
          className="flex items-center gap-1.5 text-[10px] cursor-pointer hover:opacity-80 transition-opacity"
          style={{
            color: hidden.has(rightKey) ? "var(--text-muted)" : rightColor,
            textDecoration: hidden.has(rightKey) ? "line-through" : "none",
            opacity: hidden.has(rightKey) ? 0.5 : 1,
            background: "none",
            border: "none",
            padding: 0,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: hidden.has(rightKey) ? "var(--text-muted)" : rightColor,
              display: "inline-block",
            }}
          />
          {rightLabel}
        </button>
      </div>
    </div>
  );
}
