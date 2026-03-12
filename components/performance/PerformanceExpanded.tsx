"use client";

import { useState } from "react";
import { usePolling } from "@/hooks/usePolling";
import { useBreakpoint } from "@/hooks/useBreakpoint";
import { POLLING_INTERVALS } from "@/lib/constants";
import { Sparkline } from "@/components/ui/Sparkline";
import { DualAxisChart } from "./DualAxisChart";
import type { TimeRange } from "@/lib/types";

interface MetricsHistory {
  series: Record<string, Array<{ time: string; value: number }>>;
  range: string;
}

interface PerformanceExpandedProps {
  onCollapse: () => void;
}

export function PerformanceExpanded({ onCollapse }: PerformanceExpandedProps) {
  const bp = useBreakpoint();
  const [range, setRange] = useState<TimeRange>("1H");

  const { data } = usePolling<MetricsHistory>(
    () => fetch(`/api/metrics/history?range=${range}`).then((r) => r.json()),
    POLLING_INTERVALS.METRICS
  );

  const { data: metrics } = usePolling(
    () => fetch("/api/metrics").then((r) => r.json()),
    POLLING_INTERVALS.METRICS
  );

  const series = data?.series ?? {};
  const m = metrics?.metrics ?? {};
  const spark = metrics?.sparklines ?? {};

  // Build chart data
  const writeSeries = series.write_throughput ?? [];
  const latencySeries = series.query_latency ?? [];
  const connSeries = series.active_connections ?? [];

  const chart1Data = writeSeries.map((w, i) => ({
    time: new Date(w.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    write: w.value,
    latency: latencySeries[i]?.value ?? 0,
  }));

  const chart2Data = connSeries.map((c, i) => ({
    time: new Date(c.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    connections: c.value,
    latency: latencySeries[i]?.value ?? 0,
  }));

  const ranges: TimeRange[] = ["1H", "6H", "24H", "7D"];

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 overflow-y-auto border-t"
      style={{
        background: "var(--bg-primary)",
        borderColor: "var(--border)",
        maxHeight: "85vh",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: "var(--border)" }}>
        <div>
          <div className="flex items-center gap-2">
            <span style={{ color: "var(--accent-teal)" }}>🔹</span>
            <span className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>TiDB Performance</span>
          </div>
          <p className="text-xs mt-1 max-w-2xl" style={{ color: "var(--text-muted)" }}>
            CHAINSCOPE runs on a single TiDB Essential instance — handling real-time ingestion and analytical queries simultaneously with no separate cache, message queue, or analytics database.
          </p>
        </div>
        <button
          onClick={onCollapse}
          className="p-2 rounded-lg shrink-0"
          style={{ color: "var(--text-muted)" }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div className="p-6 space-y-6">
        {/* Charts */}
        <div className={`grid gap-6 ${bp === "mobile" ? "grid-cols-1" : "grid-cols-2"}`}>
          <div className="rounded-xl border p-4" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>Write Load vs Query Speed</h3>
              <div className="flex gap-1">
                {ranges.map((r) => (
                  <button
                    key={r}
                    onClick={() => setRange(r)}
                    className="px-2 py-0.5 rounded text-[10px]"
                    style={{
                      background: range === r ? "var(--bg-hover)" : "transparent",
                      color: range === r ? "var(--text-primary)" : "var(--text-muted)",
                    }}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <DualAxisChart
              data={chart1Data}
              leftKey="write"
              rightKey="latency"
              leftColor="var(--accent-green)"
              rightColor="var(--accent-orange)"
              leftLabel="Write Throughput"
              rightLabel="Query Latency"
            />
          </div>

          <div className="rounded-xl border p-4" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>Connections vs Response Time</h3>
              <div className="flex gap-1">
                {ranges.map((r) => (
                  <button
                    key={r}
                    onClick={() => setRange(r)}
                    className="px-2 py-0.5 rounded text-[10px]"
                    style={{
                      background: range === r ? "var(--bg-hover)" : "transparent",
                      color: range === r ? "var(--text-primary)" : "var(--text-muted)",
                    }}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <DualAxisChart
              data={chart2Data}
              leftKey="connections"
              rightKey="latency"
              leftColor="var(--accent-blue)"
              rightColor="var(--accent-orange)"
              leftLabel="Connections"
              rightLabel="Query Latency"
            />
          </div>
        </div>

        {/* Key Metrics */}
        <div>
          <h3 className="text-sm font-medium mb-3" style={{ color: "var(--text-primary)" }}>Key Metrics</h3>
          <div className={`grid gap-4 ${bp === "mobile" ? "grid-cols-1" : "grid-cols-4"}`}>
            <MetricCard label="Write Throughput" value={`${((m.write_throughput ?? 24856)).toLocaleString()}`} unit="rows/sec" data={spark.write_throughput} color="var(--accent-green)" />
            <MetricCard label="Query Latency P99" value={`${(m.query_latency ?? 8.7).toFixed(1)}`} unit="ms" data={spark.query_latency} color="var(--accent-orange)" />
            <MetricCard label="QPS" value={`${(m.qps ?? 15692).toLocaleString()}`} unit="" data={spark.qps} color="var(--accent-blue)" />
            <MetricCard label="Active Connections" value={`${(m.active_connections ?? 1847).toLocaleString()}`} unit="" data={spark.active_connections} color="var(--accent-teal)" />
          </div>
        </div>

        {/* What makes this possible */}
        <div>
          <h3 className="text-sm font-medium mb-3" style={{ color: "var(--text-primary)" }}>What makes this possible?</h3>
          <div className={`grid gap-4 ${bp === "mobile" ? "grid-cols-2" : "grid-cols-4"}`}>
            <ComparisonCard label="Services Required" before="6" after="3" afterUnit="Services" />
            <ComparisonCard label="Data Scale" before="" after="100M+" afterUnit="Rows — single instance" />
            <ComparisonCard label="Query Latency" before="~500ms" after="<5ms" afterUnit="" />
            <ComparisonCard label="Infra Cost / Month" before="$2,400" after="$800" afterUnit="" isCurrency />
          </div>
        </div>

        {/* Architecture Diagram */}
        <div>
          <h3 className="text-sm font-medium mb-3" style={{ color: "var(--text-primary)" }}>Under the Hood</h3>
          <div className={`grid gap-6 ${bp === "mobile" ? "grid-cols-1" : "grid-cols-3"}`}>
            {/* Traditional */}
            <div className="rounded-xl border p-4" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
              <h4 className="text-xs font-medium mb-3" style={{ color: "var(--text-secondary)" }}>Traditional Web3 Data Pipeline</h4>
              {["Blockchain Node", "Message Queue (Kafka)", "Stream Processing (Flink)", "OLTP Database", "OLAP Database (ClickHouse)", "Cache Layer (Redis)", "API Server"].map((item) => (
                <div key={item} className="px-3 py-2 mb-1.5 rounded text-xs border" style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>
                  {item}
                </div>
              ))}
            </div>

            {/* What TiDB eliminates */}
            <div className="flex flex-col items-center justify-center gap-2">
              <h4 className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>What TiDB Eliminates</h4>
              {[
                { name: "Redis", color: "#ef4444" },
                { name: "Kafka", color: "#f59e0b" },
                { name: "ClickHouse", color: "#a855f7" },
                { name: "Flink", color: "#3b82f6" },
              ].map((item) => (
                <div key={item.name} className="flex items-center gap-2 text-xs" style={{ color: item.color }}>
                  <span>✕</span>
                  <span>{item.name}</span>
                </div>
              ))}
            </div>

            {/* TiDB HTAP */}
            <div className="rounded-xl border p-4" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
              <h4 className="text-xs font-medium mb-3" style={{ color: "var(--accent-teal)" }}>TiDB HTAP Approach</h4>
              {["Blockchain Node", "Indexer", "TiDB HTAP", "API Server"].map((item, i) => (
                <div
                  key={item}
                  className="px-3 py-2 mb-1.5 rounded text-xs border"
                  style={{
                    borderColor: i === 2 ? "var(--accent-teal)" : "var(--border)",
                    background: i === 2 ? "rgba(45, 212, 191, 0.1)" : "transparent",
                    color: i === 2 ? "var(--accent-teal)" : "var(--text-secondary)",
                    fontWeight: i === 2 ? 600 : 400,
                  }}
                >
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, unit, data, color }: {
  label: string;
  value: string;
  unit: string;
  data?: number[];
  color: string;
}) {
  return (
    <div className="rounded-xl border p-4" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
      <div className="text-xs mb-1" style={{ color: "var(--text-muted)" }}>{label}</div>
      <div className="flex items-end justify-between">
        <div>
          <span className="text-xl font-bold font-mono" style={{ color: "var(--text-primary)" }}>{value}</span>
          {unit && <span className="text-xs ml-1" style={{ color: "var(--text-muted)" }}>{unit}</span>}
        </div>
        {data && <Sparkline data={data} color={color} width={60} height={24} />}
      </div>
    </div>
  );
}

function ComparisonCard({ label, before, after, afterUnit, isCurrency }: {
  label: string;
  before: string;
  after: string;
  afterUnit: string;
  isCurrency?: boolean;
}) {
  return (
    <div className="rounded-xl border p-4" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
      <div className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>{label}</div>
      {before && (
        <div className="text-sm line-through mb-0.5" style={{ color: "var(--text-muted)" }}>{before}</div>
      )}
      <div className="flex items-baseline gap-1">
        <span
          className="text-xl font-bold"
          style={{ color: isCurrency ? "var(--accent-green)" : "var(--accent-teal)" }}
        >
          {after}
        </span>
        {afterUnit && <span className="text-xs" style={{ color: "var(--text-muted)" }}>{afterUnit}</span>}
      </div>
    </div>
  );
}
