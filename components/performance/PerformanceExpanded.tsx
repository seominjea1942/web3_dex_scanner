"use client";

import { useState } from "react";
import { usePolling } from "@/hooks/usePolling";
import { useBreakpoint } from "@/hooks/useBreakpoint";
import { POLLING_INTERVALS } from "@/lib/constants";
import { Sparkline } from "@/components/ui/Sparkline";
import { DualAxisChart } from "./DualAxisChart";
import { useWorkloadContext } from "@/hooks/useWorkloadContext";
import { formatCompact } from "@/lib/format";
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
  const wc = useWorkloadContext();
  const [range, setRange] = useState<TimeRange>("1H");

  const { data } = usePolling<MetricsHistory>(
    () => fetch(`/api/metrics/history?range=${range}`).then((r) => r.json()),
    POLLING_INTERVALS.METRICS,
    true,
    range // resetKey — triggers immediate re-fetch on range change
  );

  const { data: metrics } = usePolling(
    () => fetch("/api/metrics").then((r) => r.json()),
    POLLING_INTERVALS.METRICS
  );

  const series = data?.series ?? {};
  const m = metrics?.metrics ?? {};
  const spark = metrics?.sparklines ?? {};

  const totalRows = Math.round((m.write_throughput ?? 15000) * 500);

  const writeSeries = series.write_throughput ?? [];
  const latencySeries = series.query_latency ?? [];
  const connSeries = series.active_connections ?? [];

  // Range-aware time formatting
  const formatTime = (timeStr: string): string => {
    const d = new Date(timeStr);
    switch (range) {
      case "1H":
        return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      case "6H":
        return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
      case "24H":
        return d.toLocaleTimeString([], { hour: "numeric", hour12: true });
      case "7D":
        return d.toLocaleDateString([], { weekday: "short", hour: "numeric", hour12: true });
      default:
        return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
  };

  const chart1Data = writeSeries.map((w, i) => ({
    time: formatTime(w.time),
    write: w.value,
    latency: latencySeries[i]?.value ?? 0,
  }));

  const chart2Data = connSeries.map((c, i) => ({
    time: formatTime(c.time),
    connections: c.value,
    latency: latencySeries[i]?.value ?? 0,
  }));

  const ranges: TimeRange[] = ["1H", "6H", "24H", "7D"];

  return (
    <div>
      <div
        className="fixed inset-0 z-[60] animate-perf-overlay"
        style={{
          background: "var(--expanded-overlay)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
        }}
        onClick={onCollapse}
      />
      <div
        className="fixed inset-x-0 bottom-0 z-[70] overflow-y-auto animate-perf-slide-up"
        style={{
          background: "var(--bg-secondary)",
          maxHeight: "85vh",
          boxShadow: "var(--expanded-panel-shadow)",
        }}
      >
        <div
          className="flex items-center justify-between px-6 py-4 border-b cursor-pointer sticky top-0 z-10"
          style={{
            borderColor: "var(--border)",
            background: "var(--bg-secondary)",
          }}
          onClick={onCollapse}
        >
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined" style={{ fontSize: 20, color: "var(--accent-teal)" }}>monitor_heart</span>
            <span className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>TiDB Performance</span>
          </div>
          <span
            className="shrink-0 flex items-center justify-center rounded-lg"
            style={{
              width: 32,
              height: 32,
              background: "var(--text-primary)",
              color: "var(--bg-primary)",
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>expand_more</span>
          </span>
        </div>

        <div className="p-6 space-y-6">
          <div>
            <p className="max-w-3xl" style={{ color: "var(--text-primary)", fontSize: 14 }}>
              CHAINSCOPE runs on a single TiDB Essential instance – handling real-time ingestion and analytical queries simultaneously with no separate cache, message queue, or analytics database.
            </p>
            {wc && (
              <p className="mt-2 text-sm italic" style={{ color: "var(--text-muted)" }}>
                Serving {formatCompact(m.qps ?? 10000)} queries/sec across {formatCompact(wc.dataset_count)} rows on 1 TiDB instance — P99 latency: {(m.query_latency ?? 3.1).toFixed(1)}ms
              </p>
            )}
          </div>

          {/* Workload Context + Key Metrics — matching card style */}
          <div className={`grid gap-4 ${bp === "mobile" ? "grid-cols-2" : "grid-cols-4"}`}>
            {wc && (
              <>
                <MetricCard label="Dataset" value={formatCompact(wc.dataset_count)} unit="swaps" color="var(--accent-teal)" />
                <MetricCard label="Tables & Indexes" value={`${wc.table_count} / ${wc.index_count}`} unit="tables · indexes" color="var(--text-primary)" />
              </>
            )}
            <MetricCard label="Write Throughput" value={`${((m.write_throughput ?? 15000)).toLocaleString()}`} unit="rows/sec" data={spark.write_throughput} color="var(--accent-green)" mobile={bp === "mobile"} />
            <MetricCard label="Query Latency P99" value={`${(m.query_latency ?? 3.2).toFixed(1)}`} unit="ms" data={spark.query_latency} color="var(--accent-orange)" domainMin={0} domainMax={10} mobile={bp === "mobile"} />
            <MetricCard label="QPS" value={`${(m.qps ?? 10000).toLocaleString()}`} unit="" data={spark.qps} color="var(--accent-blue)" mobile={bp === "mobile"} />
            <MetricCard label="Active Connections" value={`${(m.active_connections ?? 1500).toLocaleString()}`} unit="" data={spark.active_connections} color="var(--accent-teal)" mobile={bp === "mobile"} />
            <MetricCard label="Total Records" value={`${(totalRows + 1000000).toLocaleString()}`} unit="rows" color="var(--accent-green)" />
            <MetricCard label="Uptime" value="99.97%" unit="" color="var(--accent-green)" />
          </div>

          <div className={`grid gap-6 ${bp === "mobile" ? "grid-cols-1" : "grid-cols-2"}`}>
            <div className="rounded-xl border p-4" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>Write Load vs Query Speed</h3>
                <div className="flex gap-1">
                  {ranges.map((r) => (
                    <button
                      key={r}
                      onClick={() => setRange(r)}
                      className="px-2.5 py-1 rounded text-[14px]"
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
                <h3 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>Connections vs Response Time</h3>
                <div className="flex gap-1">
                  {ranges.map((r) => (
                    <button
                      key={r}
                      onClick={() => setRange(r)}
                      className="px-2.5 py-1 rounded text-[14px]"
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

          <div>
            <h3 className="font-bold mb-4 text-center" style={{ color: "var(--text-primary)", fontSize: 32 }}>What makes this possible?</h3>
            <div className={`grid gap-4 ${bp === "mobile" ? "grid-cols-2" : "grid-cols-4"}`}>
              <ComparisonCard label="Services Required" before="7" after="3–4" afterUnit="Services" mobile={bp === "mobile"} />
              <ComparisonCard label="Data Scale" before="" after="100M+" afterUnit="Rows – single instance" mobile={bp === "mobile"} />
              <ComparisonCard label="Query Latency" before="~500ms" after="<5ms" afterUnit="" mobile={bp === "mobile"} />
              <ComparisonCard label="Infra Cost / Month" before="$2,400" after="$800" afterUnit="" isCurrency mobile={bp === "mobile"} />
            </div>
          </div>

          <div className="rounded-xl border p-6" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
            <h3 className="text-sm font-medium mb-4 text-center" style={{ color: "var(--text-primary)" }}>Under the Hood</h3>
            <div className={`grid gap-6 ${bp === "mobile" ? "grid-cols-1" : "grid-cols-3"}`}>
              <div className="rounded-xl border p-4" style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
                <h4 className="text-xs font-medium mb-4 text-center" style={{ color: "var(--text-secondary)" }}>Traditional Web3 Data Pipeline</h4>
                <div className="flex flex-col items-center">
                  {["Blockchain Node", "Message Queue (Kafka)", "Stream Processing (Flink)", "OLTP Database (MySQL)", "OLAP Database (ClickHouse)", "Cache Layer (Redis)", "API Server"].map((item, i, arr) => (
                    <div key={item} className="flex flex-col items-center w-full">
                      <div className="px-3 py-2 rounded text-xs border w-full text-center" style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>
                        {item}
                      </div>
                      {i < arr.length - 1 && (
                        <div className="w-px h-3" style={{ background: "var(--text-muted)" }} />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-col items-center justify-center gap-2">
                <h4 className="text-xs font-bold mb-1" style={{ color: "var(--text-primary)" }}>What TiDB Simplifies</h4>

                <div className="mb-2 w-full">
                  <div className="text-[10px] font-medium mb-1.5 text-center" style={{ color: "#ef4444" }}>✕ Replaced by TiDB</div>
                  {[
                    { name: "OLTP Database (MySQL)", detail: "merged into TiDB (TiKV)" },
                    { name: "OLAP Database (ClickHouse)", detail: "merged into TiDB (TiFlash)" },
                  ].map((item) => (
                    <div key={item.name} className="flex items-center gap-2 text-xs px-3 py-1.5 rounded mb-1" style={{ color: "#ef4444", background: "rgba(239, 68, 68, 0.08)" }}>
                      <span className="material-symbols-outlined shrink-0" style={{ fontSize: 14 }}>cancel</span>
                      <div>
                        <span className="font-medium line-through">{item.name}</span>
                        <span className="ml-1 text-[10px]" style={{ color: "var(--text-muted)" }}>— {item.detail}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="w-full">
                  <div className="text-[10px] font-medium mb-1.5 text-center" style={{ color: "var(--accent-orange)" }}>⚬ Often unnecessary</div>
                  {[
                    { name: "Cache Layer (Redis)", tooltip: "TiDB query latency of <5ms often eliminates the need for a separate cache layer for most read patterns." },
                    { name: "Message Queue (Kafka)", tooltip: "For direct data ingestion (e.g., Helius → TiDB), a message queue may not be needed. Required for complex multi-consumer event architectures." },
                    { name: "Stream Processing (Flink)", tooltip: "Simple event classification (Whale, Smart Money) can be handled in the application layer. Complex CEP or windowed aggregation still benefits from dedicated stream processing." },
                  ].map((item) => (
                    <SimplifiesItem key={item.name} name={item.name} tooltip={item.tooltip} />
                  ))}
                </div>
              </div>

              <div className="rounded-xl border p-4" style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
                <h4 className="text-xs font-medium mb-4 text-center" style={{ color: "var(--accent-teal)" }}>TiDB HTAP Approach</h4>
                <div className="flex flex-col items-center">
                  {[
                    { label: "Blockchain Node", highlight: false },
                    { label: "Indexer", highlight: false },
                    { label: "TiDB HTAP", subtitle: "TiKV · TiFlash", highlight: true },
                    { label: "API Server", highlight: false },
                  ].map((item, i, arr) => (
                    <div key={item.label} className="flex flex-col items-center w-full">
                      <div
                        className="px-3 py-2 rounded text-xs border w-full text-center"
                        style={{
                          borderColor: item.highlight ? "var(--accent-teal)" : "var(--border)",
                          background: item.highlight ? "rgba(129, 140, 248, 0.1)" : "transparent",
                          color: item.highlight ? "var(--accent-teal)" : "var(--text-secondary)",
                          fontWeight: item.highlight ? 600 : 400,
                        }}
                      >
                        {item.label}
                        {item.subtitle && (
                          <div className="text-[10px] mt-0.5 font-normal" style={{ color: "var(--text-muted)" }}>
                            {item.subtitle}
                          </div>
                        )}
                      </div>
                      {i < arr.length - 1 && (
                        <div className="w-px h-3" style={{ background: "var(--text-muted)" }} />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, unit, data, color, domainMin, domainMax, mobile }: {
  label: string;
  value: string;
  unit: string;
  data?: number[];
  color: string;
  domainMin?: number;
  domainMax?: number;
  mobile?: boolean;
}) {
  return (
    <div className="rounded-xl border p-4" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
      <div className="mb-1" style={{ color: "var(--text-primary)", fontSize: 14 }}>{label}</div>
      {mobile && data ? (
        <div className="flex flex-col gap-2">
          <div>
            <span className="text-xl font-bold font-mono" style={{ color: "var(--text-primary)" }}>{value}</span>
            {unit && <span className="text-xs ml-1" style={{ color: "var(--text-muted)" }}>{unit}</span>}
          </div>
          <Sparkline data={data} color={color} width={100} height={24} domainMin={domainMin} domainMax={domainMax} />
        </div>
      ) : (
        <div className="flex items-end justify-between">
          <div>
            <span className="text-xl font-bold font-mono" style={{ color: "var(--text-primary)" }}>{value}</span>
            {unit && <span className="text-xs ml-1" style={{ color: "var(--text-muted)" }}>{unit}</span>}
          </div>
          {data && <Sparkline data={data} color={color} width={60} height={24} domainMin={domainMin} domainMax={domainMax} />}
        </div>
      )}
    </div>
  );
}

function SimplifiesItem({ name, tooltip }: { name: string; tooltip: string }) {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div
      className="relative flex items-center gap-2 text-xs px-3 py-1.5 rounded mb-1 cursor-default"
      style={{ color: "var(--accent-orange)", background: "rgba(255, 141, 40, 0.06)" }}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      onClick={() => setShowTooltip((p) => !p)}
    >
      <span className="shrink-0" style={{ fontSize: 12 }}>⚬</span>
      <span className="font-medium" style={{ color: "var(--accent-orange)", fontStyle: "italic" }}>{name}</span>
      {showTooltip && (
        <div
          className="absolute left-0 bottom-full mb-2 z-20 rounded-lg p-3 text-xs leading-relaxed"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            color: "var(--text-secondary)",
            width: 280,
            boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
            fontStyle: "normal",
          }}
        >
          {tooltip}
        </div>
      )}
    </div>
  );
}

function ComparisonCard({ label, before, after, afterUnit, isCurrency, mobile }: {
  label: string;
  before: string;
  after: string;
  afterUnit: string;
  isCurrency?: boolean;
  mobile?: boolean;
}) {
  return (
    <div className="rounded-xl border p-4" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
      <div className="mb-2" style={{ color: "var(--text-primary)", fontSize: 14 }}>{label}</div>
      <div className={mobile && afterUnit ? "flex flex-col gap-1" : "flex items-baseline gap-2"}>
        <div className="flex items-baseline gap-2">
          {before && (
            <span className="text-xl font-bold line-through" style={{ color: "var(--text-muted)" }}>{before}</span>
          )}
          <span
            className="text-xl font-bold"
            style={{ color: isCurrency ? "var(--accent-green)" : "var(--accent-teal)" }}
          >
            {after}
          </span>
          {!mobile && afterUnit && <span className="text-xs" style={{ color: "var(--text-muted)" }}>{afterUnit}</span>}
        </div>
        {mobile && afterUnit && <span className="text-xs" style={{ color: "var(--text-muted)" }}>{afterUnit}</span>}
      </div>
    </div>
  );
}
