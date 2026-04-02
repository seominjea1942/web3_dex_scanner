"use client";

import React, { useState } from "react";
import { usePolling } from "@/hooks/usePolling";
import { useBreakpoint } from "@/hooks/useBreakpoint";
import { POLLING_INTERVALS } from "@/lib/constants";
import { Sparkline } from "@/components/ui/Sparkline";
import { DualAxisChart } from "./DualAxisChart";
import { EventTicker } from "@/components/events/EventTicker";
import { useWorkloadContext } from "@/hooks/useWorkloadContext";
import { useSharedMetrics } from "@/hooks/useSharedMetrics";
import { formatCompact } from "@/lib/format";
import type { TimeRange } from "@/lib/types";
import { ContactFormModal } from "./ContactFormModal";

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
  const [contactOpen, setContactOpen] = useState(false);

  const { data } = usePolling<MetricsHistory>(
    () => fetch(`/api/metrics/history?range=${range}`).then((r) => r.json()),
    POLLING_INTERVALS.METRICS,
    true,
    range // resetKey — triggers immediate re-fetch on range change
  );

  // Use shared metrics instead of own polling
  const { data: metrics } = useSharedMetrics();

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
    <div
      className="fixed inset-0 z-[60] flex flex-col animate-perf-slide-up"
      style={{ background: "var(--bg-secondary)" }}
    >
      {/* Live event ticker at the very top */}
      <EventTicker onClick={() => {}} />

      {/* Header */}
      <div
        className="flex items-center justify-between px-6 py-4 border-b cursor-pointer shrink-0"
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
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
        </span>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">

        <div className="p-6 space-y-6">
          <div>
            <p className="max-w-3xl" style={{ color: "var(--text-primary)", fontSize: 16 }}>
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
                <div className="rounded-xl border p-4" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
                  <div className="mb-1" style={{ color: "var(--text-primary)", fontSize: 14 }}>Tables & Indexes</div>
                  <div className="flex items-baseline gap-1 flex-wrap">
                    <span className="text-xl font-bold font-mono" style={{ color: "var(--text-primary)" }}>{wc.table_count}</span>
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>tables ·</span>
                    <span className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>{wc.index_count}</span>
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>indexes</span>
                  </div>
                </div>
              </>
            )}
            <MetricCard label="Write Throughput" value={`${((m.write_throughput ?? 15000)).toLocaleString()}`} unit="rows/sec" data={spark.write_throughput} color="var(--accent-green)" mobile={bp === "mobile"} />
            <MetricCard label="Query Latency P99" value={`${(m.query_latency ?? 3.2).toFixed(1)}`} unit="ms" data={spark.query_latency} color="var(--accent-orange)" domainMin={0} domainMax={10} mobile={bp === "mobile"} />
            <MetricCard label="QPS" value={`${(m.qps ?? 10000).toLocaleString()}`} unit="R 35% · W 65%" data={spark.qps} color="var(--accent-blue)" mobile={bp === "mobile"} />
            <MetricCard label="Active Connections" value={`${(m.active_connections ?? 1500).toLocaleString()}`} unit="" data={spark.active_connections} color="var(--accent-teal)" mobile={bp === "mobile"} />
            <MetricCard label="Total Records" value={`${(totalRows + 1000000).toLocaleString()}`} unit="rows" color="var(--accent-green)" />
            <MetricCard label="Uptime" value="99.97%" unit="" color="var(--accent-green)" />
          </div>

          <div className={`grid gap-4 ${bp === "mobile" ? "grid-cols-1" : "grid-cols-2"}`}>
            <div className="rounded-xl border p-4" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
              <div className={`${bp === "mobile" ? "flex flex-col gap-2" : "flex items-center justify-between"} mb-3`}>
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
              <div className={`${bp === "mobile" ? "flex flex-col gap-2" : "flex items-center justify-between"} mb-3`}>
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

          <div className="h-px" style={{ background: "var(--border)", marginTop: 48, marginBottom: 48 }} />

          <div>
            <h3 className="font-bold mb-4 text-center" style={{ color: "var(--text-primary)", fontSize: 32 }}>How it works</h3>
            <div className={`grid gap-4 ${bp === "mobile" ? "grid-cols-2" : "grid-cols-4"}`}>
              <ComparisonCard label="Services Required" before="7" after="3–4" afterUnit="Services" mobile={bp === "mobile"} />
              <ComparisonCard label="Data Scale" before="" after="10M+" afterUnit="Rows" mobile={bp === "mobile"} />
              <ComparisonCard label="Query Latency" before="~500ms" after="<5ms" afterUnit="" mobile={bp === "mobile"} />
              <ComparisonCard label="Infra Cost / Month" before="$2,400" after="$400" afterUnit="" isCurrency mobile={bp === "mobile"} />
            </div>
          </div>

          {/* Architecture Comparison + What TiDB Simplifies — single card */}
          <div className="rounded-xl border p-4" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
            <div className={`grid gap-4 ${bp === "mobile" ? "grid-cols-1" : "grid-cols-2"}`}>
              {/* Left: Pipeline VS Comparison — darker bg */}
              <div className="rounded-xl p-5" style={{ background: "var(--bg-secondary)" }}>
                <div className={`grid gap-3 ${bp === "mobile" ? "grid-cols-1" : "grid-cols-[1fr_auto_1fr]"} items-start`}>
                  {/* Traditional Pipeline */}
                  <div>
                    <h4 className="text-sm font-bold mb-4 text-center" style={{ color: "var(--text-primary)" }}>Traditional Web3<br />Data Pipeline</h4>
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

                  {/* VS divider */}
                  <div className="flex items-center justify-center self-center py-8">
                    <span className="text-base font-bold px-3 py-1.5 rounded" style={{ color: "var(--text-muted)", background: "var(--bg-hover)" }}>VS</span>
                  </div>

                  {/* TiDB HTAP Approach */}
                  <div>
                    <h4 className="text-sm font-bold mb-4 text-center" style={{ color: "var(--accent-teal)" }}>TiDB HTAP<br />Approach</h4>
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

              {/* Right: What TiDB Simplifies */}
              <div className="p-5">
                {/* Replaced by TiDB */}
                <div className="mb-5">
                  <div className="text-[11px] font-medium mb-3 flex items-center gap-1.5 uppercase tracking-wider" style={{ color: "var(--accent-red)" }}>
                    <span>✕</span> replaced by tidb
                  </div>
                  {REPLACED_ITEMS.map((item) => (
                    <SimplifiesRow key={item.name} item={item} />
                  ))}
                </div>

                <div className="h-px" style={{ background: "var(--border)" }} />

                {/* Often unnecessary */}
                <div className="mt-5">
                  <div className="text-[11px] font-medium mb-3 flex items-center gap-1.5 uppercase tracking-wider" style={{ color: "var(--accent-orange)" }}>
                    <span>○</span> often unnecessary
                  </div>
                  {UNNECESSARY_ITEMS.map((item) => (
                    <SimplifiesRow key={item.name} item={item} />
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="h-px" style={{ background: "var(--border)", marginTop: 48, marginBottom: 48 }} />

          {/* Already on MySQL? You're ready. */}
          <div>
            <h3 className="font-bold mb-2 text-center" style={{ color: "var(--text-primary)", fontSize: 32 }}>Already on MySQL? You&apos;re ready.</h3>
            <p className="text-sm mb-6 text-center" style={{ color: "var(--text-secondary)" }}>
              TiDB is MySQL-compatible. Your existing queries, ORMs, and clients work without code changes.
            </p>
            <div className={`grid gap-4 ${bp === "mobile" ? "grid-cols-1" : bp === "tablet" ? "grid-cols-2" : "grid-cols-4"} items-stretch`}>
              {/* Card 1: What stays the same */}
              <a
                href="https://docs.pingcap.com/tidb/stable/mysql-compatibility/"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-xl border p-5 flex flex-col justify-between transition-colors duration-200 no-underline"
                style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(99,102,241,0.5)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; }}
              >
                <div>
                  <h4 className="text-sm font-semibold mb-4" style={{ color: "var(--text-primary)" }}>What Stays the Same</h4>
                  <div className="flex flex-col gap-3">
                    {["Standard SQL (ANSI-Compatible)", "Transactions & ACID Guarantees", "Joins, Subqueries, Views", "Common ORMs & Drivers"].map((item) => (
                      <div key={item} className="flex items-start gap-2.5 text-sm">
                        <span className="material-symbols-outlined shrink-0" style={{ fontSize: 18, color: "var(--accent-green)", marginTop: 1 }}>check</span>
                        <span style={{ color: "var(--text-primary)" }}>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="font-medium mt-5 inline-flex items-center gap-1" style={{ color: "var(--accent-teal)", fontSize: 14 }}>
                  See Compatibility Details →
                </div>
              </a>

              {/* Card 2: What to review before cutover */}
              <a
                href="https://docs.pingcap.com/tidb/stable/tidb-limitations/"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-xl border p-5 flex flex-col justify-between transition-colors duration-200 no-underline"
                style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(99,102,241,0.5)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; }}
              >
                <div>
                  <h4 className="text-sm font-semibold mb-4" style={{ color: "var(--text-primary)" }}>What to Review Before Cutover</h4>
                  <div className="flex flex-col gap-3">
                    {[
                      { icon: "warning", label: "Stored Procedures (Limited)", color: "var(--accent-orange)" },
                      { icon: "close", label: "Triggers (Not Supported)", color: "var(--accent-red)" },
                      { icon: "warning", label: "MySQL-Specific Optimizer Quirks", color: "var(--accent-orange)" },
                      { icon: "warning", label: "Traffic Patterns and Deployment Topology", color: "var(--accent-orange)" },
                      { icon: "warning", label: "Current Data Flow and System Dependencies", color: "var(--accent-orange)" },
                    ].map((item) => (
                      <div key={item.label} className="flex items-start gap-2.5 text-sm">
                        <span className="material-symbols-outlined shrink-0" style={{ fontSize: 18, color: item.color, marginTop: 1 }}>{item.icon}</span>
                        <span style={{ color: "var(--text-secondary)" }}>{item.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="font-medium mt-5 inline-flex items-center gap-1" style={{ color: "var(--accent-teal)", fontSize: 14 }}>
                  See Known Limitations →
                </div>
              </a>

              {/* Card 3: If you're already on mysql */}
              <a
                href="https://docs.pingcap.com/tidb/stable/migration-overview/"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-xl border p-5 flex flex-col justify-between transition-colors duration-200 no-underline"
                style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(99,102,241,0.5)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; }}
              >
                <div>
                  <h4 className="text-sm font-semibold mb-2" style={{ color: "var(--text-primary)" }}>If You&apos;re Already on MySQL</h4>
                  <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>
                    TiDB speaks MySQL wire protocol — validate with your real workload
                  </p>
                  <div className="flex flex-col gap-2.5">
                    {["Connect with Your Existing MySQL Driver", "Load Your Real Schema + Dataset", "Replay Representative Queries", "Compare Correctness & P99 Latency", "Cut Over with Rollback Plan"].map((step, i) => (
                      <div key={step} className="flex items-start gap-1.5 text-sm">
                        <span className="shrink-0 font-semibold" style={{ color: "var(--accent-teal)", fontSize: 13, width: 14 }}>{i + 1}.</span>
                        <span style={{ color: "var(--text-primary)" }}>{step}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="font-medium mt-5 inline-flex items-center gap-1" style={{ color: "var(--accent-teal)", fontSize: 14 }}>
                  See MySQL Migration Guide →
                </div>
              </a>

              {/* Card 4: Migrating from another stack */}
              <button
                onClick={() => setContactOpen(true)}
                className="rounded-xl border p-5 flex flex-col justify-between transition-colors duration-200 text-left"
                style={{ background: "var(--bg-card)", borderColor: "var(--border)", cursor: "pointer" }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(99,102,241,0.5)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; }}
              >
                <div>
                  <h4 className="text-sm font-semibold mb-2" style={{ color: "var(--text-primary)" }}>Migrating from Another Stack</h4>
                  <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>
                    Not on MySQL? Here&apos;s your checklist.
                  </p>
                  <div className="flex flex-col gap-2.5">
                    {["Review Schema Translation and Query Compatibility", "Assess Required Application-Layer Changes", "Validate Current Pipeline and Service Dependencies", "Use a Staged Proof Before Production Cutover"].map((step, i) => (
                      <div key={step} className="flex items-start gap-1.5 text-sm">
                        <span className="shrink-0 font-semibold" style={{ color: "var(--accent-teal)", fontSize: 13, width: 14 }}>{i + 1}.</span>
                        <span style={{ color: "var(--text-primary)" }}>{step}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="font-medium mt-5 inline-flex items-center gap-1" style={{ color: "var(--accent-teal)", fontSize: 14 }}>
                  Talk to Our Team →
                </div>
              </button>
            </div>

            {/* CTA Bar */}
            <div className={`mt-6 rounded-xl border p-5 ${bp === "mobile" ? "flex flex-col gap-4" : "flex items-center justify-between"}`} style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
              <div>
                <h4 className="text-base font-bold mb-1" style={{ color: "var(--text-primary)" }}>Build a Migration Plan with TiDB</h4>
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                  Review your current stack with our team — identify risk areas and map a validation path before cutover.
                </p>
              </div>
              <button
                onClick={() => setContactOpen(true)}
                className={`shrink-0 ${bp === "mobile" ? "self-start" : "ml-6"} px-6 py-2.5 rounded-full border text-sm font-medium transition-colors duration-200`}
                style={{ borderColor: "var(--text-muted)", color: "var(--text-primary)", background: "none", cursor: "pointer" }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(99,102,241,0.5)"; e.currentTarget.style.color = "var(--accent-teal)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--text-muted)"; e.currentTarget.style.color = "var(--text-primary)"; }}
              >
                Check Migration Fit →
              </button>
            </div>
          </div>

          <div className="h-px" style={{ background: "var(--border)", marginTop: 48, marginBottom: 48 }} />

          {/* Feature Comparison Table */}
          <div>
            <h3 className="font-bold mb-2 text-center" style={{ color: "var(--text-primary)", fontSize: 32 }}>Why TiDB for Web3?</h3>
            <p className="text-sm mb-4 text-center" style={{ color: "var(--text-secondary)" }}>
              The only MySQL-compatible, open-source database with native HTAP, full-text search, and vector search in a single cluster.
            </p>
            <div className="rounded-xl border p-4" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
              <FeatureComparisonTable mobile={bp === "mobile"} />
            </div>
          </div>
        </div>
      </div>
      <ContactFormModal open={contactOpen} onClose={() => setContactOpen(false)} />
    </div>
  );
}

/* ── Feature Comparison Table ── */

/* ── Replaced / Unnecessary items ── */

interface SimplifiesItemData {
  name: string;
  role: string;
  replacement: string;
  tooltip: string;
}

const REPLACED_ITEMS: SimplifiesItemData[] = [
  { name: "mysql", role: "transactions", replacement: "tikv row-store", tooltip: "TiKV is a distributed row-store using Raft consensus. Handles ACID transactions, point lookups, and range scans. MySQL wire-protocol compatible — most queries and ORMs work without code changes." },
  { name: "clickhouse", role: "analytics", replacement: "tiflash columnar engine", tooltip: "TiFlash is a columnar replica that auto-syncs from TiKV. Handles aggregation, GROUP BY, and full-table scans without a separate ETL pipeline. Replication lag from TiKV → TiFlash is typically <1s." },
  { name: "elasticsearch", role: "search", replacement: "tici full-text index", tooltip: "TiCI (TiDB Column Index) provides inverted indexes on columnar storage. Supports full-text search, boolean mode, and fuzzy matching on token names and addresses. No external Elasticsearch needed." },
  { name: "kafka", role: "inter-db sync", replacement: "single db. nothing to sync.", tooltip: "When OLTP and OLAP live in the same cluster, there's no data to replicate between separate databases — the sync layer becomes unnecessary. Kafka as a general-purpose message broker is a different role entirely. Complex event orchestration, replay, multi-producer routing — that's not what TiDB replaces." },
];

const UNNECESSARY_ITEMS: SimplifiesItemData[] = [
  { name: "redis", role: "hot query cache", replacement: "2.8ms p99 covers most read patterns", tooltip: "With 2.8ms p99 query latency, most read-path caching patterns are covered without a separate cache layer. For sub-millisecond requirements (e.g. trading engine hot path), a dedicated cache may still be warranted." },
  { name: "flink", role: "stream processing", replacement: "sql-native aggregation in tidb", tooltip: "TiDB handles real-time aggregation natively in SQL — token rankings, volume calculations, time-windowed analytics. For complex event processing (CEP) or stateful stream transformations, a dedicated stream processor may still add value." },
];

const COMPARE_COLS = ["TiDB", "Spanner", "CockroachDB", "Vitess", "Lindorm"] as const;

interface FeatureRow {
  key: string;
  marks: [string, string, string, string, string]; // ✓ ✗ ~ or custom text
  title: string;
  bullets: string[];
}

const FEATURE_ROWS: FeatureRow[] = [
  {
    key: "htap",
    marks: ["✓", "~", "✗", "✗", "✗"],
    title: "HTAP (Hybrid Transactional/Analytical Processing)",
    bullets: [
      "TiDB processes OLTP (TiKV, row-store) and OLAP (TiFlash, columnar) in a single cluster. Replication lag: TiKV → TiFlash typically <1s.",
      "Why it matters for blockchain: Real-time writes (new blocks) + instant analytics (token rankings, volume aggregation) without ETL.",
    ],
  },
  {
    key: "mysql_compat",
    marks: ["✓", "✗", "✗", "✓", "✗"],
    title: "MySQL Wire Protocol Compatible",
    bullets: [
      "Supported: standard SQL, JOINs, subqueries, transactions, most ORMs (Sequelize, Prisma, etc). Partial: stored procedures (limited), triggers (not supported).",
      "For most read/write workloads, zero code changes from MySQL.",
    ],
  },
  {
    key: "full_text_search",
    marks: ["✓", "✓", "✗", "✗", "~"],
    title: "Full-Text Search via TiCI (TiDB Column Index)",
    bullets: [
      "Inverted index built on columnar storage. No external Elasticsearch needed. Supports: natural language search, boolean mode, fuzzy matching on token names/addresses.",
      "Note: Spanner also supports full-text search (Enterprise edition). TiDB's advantage here is TiCI integration — full-text, vector, and multi-column indexing in one engine, no separate configuration.",
    ],
  },
  {
    key: "vector_search",
    marks: ["✓", "✓", "✗", "✗", "~"],
    title: "Vector Search via TiCI",
    bullets: [
      "Native vector index on columnar storage. Supports cosine similarity, L2 distance. No external Pinecone/Milvus needed.",
      "Note: Spanner supports ANN vector search via ScaNN. TiDB's advantage is unified indexing — vector search lives alongside full-text and columnar indexes in TiCI, with no separate vector index infrastructure.",
    ],
  },
  {
    key: "cloud_native",
    marks: ["✓", "✓", "✓", "~", "✓"],
    title: "Cloud-Native Architecture",
    bullets: [
      "Separated compute and storage layers. Auto-scaling based on workload. Multi-AZ deployment for high availability.",
      "TiDB Cloud Serverless: pay only for what you use, scale to zero when idle.",
    ],
  },
  {
    key: "auto_sharding",
    marks: ["✓", "✓", "✓", "✗", "✓"],
    title: "Automatic Sharding",
    bullets: [
      "Data is automatically distributed across nodes without manual shard key configuration. Horizontal scaling without application-level changes.",
      "TiDB uses Range-based sharding via TiKV Regions, automatically splitting and merging as data grows.",
    ],
  },
  {
    key: "open_source_core",
    marks: ["✓", "✗", "✗", "✓", "✗"],
    title: "Open Source Core (Apache 2.0)",
    bullets: [
      "Full source code on GitHub. No vendor lock-in. Community-driven development with enterprise support available.",
      "Run self-hosted or use TiDB Cloud managed service.",
    ],
  },
];

function markColor(mark: string): string {
  if (mark === "✓") return "var(--accent-green)";
  if (mark === "✗") return "var(--accent-red)";
  if (mark === "~") return "var(--accent-orange)";
  return "var(--text-primary)";
}

function MarkIcon({ mark }: { mark: string }) {
  if (mark === "✓") return <span className="material-symbols-outlined" style={{ fontSize: 20, color: "var(--accent-green)" }}>check</span>;
  if (mark === "✗") return <span className="material-symbols-outlined" style={{ fontSize: 20, color: "var(--accent-red)" }}>close</span>;
  if (mark === "~") return <span className="material-symbols-outlined" style={{ fontSize: 20, color: "var(--accent-orange)" }}>remove</span>;
  if (mark === "preview") return <span className="font-mono text-xs font-medium" style={{ color: "var(--accent-orange)" }}>{mark}</span>;
  return <span className="font-mono text-sm font-medium" style={{ color: "var(--text-primary)" }}>{mark}</span>;
}

function FeatureComparisonTable({ mobile }: { mobile: boolean }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const colWidth = mobile ? 72 : undefined;

  return (
    <div className="relative overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
      <table className="w-full text-sm" style={{ minWidth: mobile ? 500 : undefined, borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th
              className="text-left text-sm font-medium uppercase tracking-wider px-3 py-2 sticky left-0 z-10"
              style={{ color: "var(--text-muted)", background: "var(--bg-card)", width: mobile ? 140 : "auto" }}
            >
              Feature
            </th>
            {COMPARE_COLS.map((col, i) => (
              <th
                key={col}
                className="text-center text-sm font-medium uppercase tracking-wider px-2 py-2"
                style={{ color: i === 0 ? "var(--accent-teal)" : "var(--text-muted)", width: colWidth }}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {FEATURE_ROWS.map((row) => {
            const isOpen = expanded.has(row.key);
            const hasBullets = row.bullets.length > 0;
            return (
              <React.Fragment key={row.key}>
                <tr
                  className="border-t"
                  style={{ borderColor: "var(--border)", cursor: hasBullets ? "pointer" : "default" }}
                  onClick={() => hasBullets && toggle(row.key)}
                >
                  <td
                    className="px-3 py-3 font-mono sticky left-0 z-10"
                    style={{ color: "var(--text-primary)", background: "var(--bg-card)" }}
                  >
                    <span className="flex items-center gap-1.5">
                      {hasBullets && (
                        <span
                          className="material-symbols-outlined transition-transform"
                          style={{ fontSize: 14, color: "var(--text-muted)", transform: isOpen ? "rotate(90deg)" : "rotate(0deg)" }}
                        >
                          chevron_right
                        </span>
                      )}
                      {row.key}
                    </span>
                  </td>
                  {row.marks.map((mark, i) => (
                    <td key={i} className="text-center px-2 py-3">
                      <span className="inline-flex items-center justify-center">
                        <MarkIcon mark={mark} />
                      </span>
                    </td>
                  ))}
                </tr>
                {isOpen && hasBullets && (
                  <tr>
                    <td colSpan={COMPARE_COLS.length + 1} style={{ padding: 0 }}>
                      <div className="sticky left-0 px-3 pb-2" style={{ width: mobile ? "calc(100vw - 56px)" : "auto" }}>
                        <div
                          className="px-4 py-4 rounded-lg"
                          style={{ background: "var(--bg-secondary)", borderLeft: "3px solid var(--accent-teal)" }}
                        >
                          <div className="text-sm font-medium mb-2" style={{ color: "var(--text-primary)" }}>{row.title}</div>
                          <div className="text-sm" style={{ color: "var(--text-secondary)", lineHeight: 1.25 }}>
                            {row.bullets.map((b, i) => (
                              <span key={i}>{b}{i < row.bullets.length - 1 ? " " : ""}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
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

function SimplifiesRow({ item }: { item: SimplifiesItemData }) {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div
      className="relative flex flex-col gap-0.5 px-3 py-2.5 rounded-lg mb-1.5 cursor-default"
      style={{ background: "rgba(255,255,255,0.03)" }}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      onClick={() => setShowTooltip((p) => !p)}
    >
      <div className="text-sm font-mono" style={{ color: "var(--text-secondary)" }}>
        {item.name} <span style={{ color: "var(--text-muted)" }}>({item.role})</span>
      </div>
      <div className="flex items-center gap-1.5 text-sm">
        <span style={{ color: "var(--text-muted)" }}>→</span>
        <span className="font-mono" style={{ color: "var(--text-primary)" }}>{item.replacement}</span>
      </div>
      {showTooltip && (
        <div
          className="absolute left-0 bottom-full mb-2 z-20 rounded-xl border p-4 text-sm leading-relaxed"
          style={{
            background: "var(--bg-card)",
            borderColor: "var(--border)",
            color: "var(--text-secondary)",
            width: 360,
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          }}
        >
          <div className="text-sm font-bold mb-2 flex items-center gap-1.5" style={{ color: "var(--text-primary)" }}>
            {item.name} ({item.role})
            <span className="material-symbols-outlined" style={{ fontSize: 14, color: "var(--text-muted)" }}>info</span>
          </div>
          <p style={{ lineHeight: 1.5 }}>{item.tooltip}</p>
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
