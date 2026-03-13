"use client";

import { useState, useEffect } from "react";
import { usePolling } from "@/hooks/usePolling";
import { useBreakpoint } from "@/hooks/useBreakpoint";
import { POLLING_INTERVALS } from "@/lib/constants";
import { Sparkline } from "@/components/ui/Sparkline";
import { LiveCounter } from "@/components/ui/LiveCounter";
import { StatusDot } from "@/components/ui/StatusDot";
import { formatCompact } from "@/lib/format";

interface MetricsResponse {
  metrics: Record<string, number>;
  sparklines: Record<string, number[]>;
}

interface PerformanceBarProps {
  onExpand: () => void;
}

export function PerformanceBar({ onExpand }: PerformanceBarProps) {
  const bp = useBreakpoint();

  const { data } = usePolling<MetricsResponse>(
    () => fetch("/api/metrics").then((r) => r.json()),
    POLLING_INTERVALS.METRICS
  );

  const m = data?.metrics ?? {};
  const s = data?.sparklines ?? {};

  const txPerSec = Math.round(m.write_throughput ? m.write_throughput / 500 : 30);
  const latency = m.query_latency ?? 3.0;
  const totalRows = Math.round((m.write_throughput ?? 15000) * 500);
  const qps = m.qps ?? 10000;

  // Mobile carousel: cycle through all 6 metrics every 8s
  const [mobileIdx, setMobileIdx] = useState(0);
  useEffect(() => {
    if (bp !== "mobile") return;
    const id = setInterval(() => setMobileIdx((i) => (i + 1) % 6), 8000);
    return () => clearInterval(id);
  }, [bp]);

  const mobileItems = [
    { label: "Live Transactions", value: `${txPerSec} tx/sec`, sparkData: s.write_throughput, color: "var(--accent-green)" },
    { label: "Query Latency", value: `${latency.toFixed(1)} ms`, sparkData: s.query_latency, color: "var(--accent-orange)" },
    { label: "Concurrent Queries", value: `${formatCompact(qps)}/sec`, sparkData: s.qps, color: "var(--accent-teal)" },
    { label: "Total Records", value: `${(totalRows + 1000000).toLocaleString()} rows`, sparkData: s.write_throughput, color: "var(--accent-green)" },
    { label: "Uptime", value: "99.97%", sparkData: undefined, color: "var(--accent-green)" },
    { label: "Infrastructure", value: "1 instance", sparkData: undefined, color: "var(--accent-teal)" },
  ];

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40 border-t cursor-pointer"
      style={{
        background: "var(--perf-bar-bg)",
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
        borderColor: "var(--perf-bar-border)",
      }}
      onClick={onExpand}
    >
      <div className="flex items-center px-4 py-1.5 gap-5 overflow-x-clip">
        {/* Label */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="material-symbols-outlined" style={{ fontSize: 16, color: "var(--accent-teal)" }}>monitor_heart</span>
          <span className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
            TiDB Performance
          </span>
        </div>

        <div className="h-8 w-px shrink-0" style={{ background: "var(--border)" }} />

        {/* Mobile: cycling metric */}
        {bp === "mobile" && (
          <div className="flex items-center gap-2 shrink-0 min-w-0" style={{ transition: "opacity 0.3s ease" }}>
            <div className="flex flex-col">
              <span className="text-[10px] leading-tight" style={{ color: "var(--text-secondary)" }}>{mobileItems[mobileIdx].label}</span>
              <span className="text-xs font-mono font-medium" style={{ color: "var(--text-primary)" }}>
                {mobileItems[mobileIdx].value}
              </span>
            </div>
            {mobileItems[mobileIdx].sparkData && (
              <Sparkline data={mobileItems[mobileIdx].sparkData ?? []} color={mobileItems[mobileIdx].color} width={60} height={20} />
            )}
          </div>
        )}

        {/* Tablet+: Live Transactions always visible */}
        {bp !== "mobile" && (
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex flex-col">
              <span className="text-[10px] leading-tight" style={{ color: "var(--text-secondary)" }}>Live Transactions</span>
              <span className="text-xs font-mono font-medium" style={{ color: "var(--text-primary)" }}>
                {txPerSec} tx/sec
              </span>
            </div>
            <Sparkline data={s.write_throughput ?? []} color="var(--accent-green)" width={60} height={20} />
          </div>
        )}

        {bp !== "mobile" && (
          <>
            <div className="h-8 w-px shrink-0" style={{ background: "var(--border)" }} />

            {/* Query Latency */}
            <div className="flex items-center gap-2 shrink-0">
              <div className="flex flex-col">
                <span className="text-[10px] leading-tight" style={{ color: "var(--text-secondary)" }}>Query Latency</span>
                <span className="text-xs font-mono font-medium" style={{ color: "var(--text-primary)" }}>
                  {latency.toFixed(1)} ms
                </span>
              </div>
              <Sparkline data={s.query_latency ?? []} color="var(--accent-orange)" width={60} height={20} />
            </div>

            <div className="h-8 w-px shrink-0" style={{ background: "var(--border)" }} />

            {/* Concurrent Queries */}
            <div className="flex items-center gap-2 shrink-0">
              <div className="flex flex-col">
                <span className="text-[10px] leading-tight" style={{ color: "var(--text-secondary)" }}>Concurrent Queries</span>
                <span className="text-xs font-mono font-medium" style={{ color: "var(--text-primary)" }}>
                  {formatCompact(qps)}/sec
                </span>
              </div>
              <Sparkline data={s.qps ?? []} color="var(--accent-teal)" width={60} height={20} />
            </div>
          </>
        )}

        {bp === "desktop" && (
          <>
            <div className="h-8 w-px shrink-0" style={{ background: "var(--border)" }} />

            {/* Total Records */}
            <div className="flex flex-col shrink-0">
              <span className="text-[10px] leading-tight" style={{ color: "var(--text-secondary)" }}>Total Records</span>
              <div className="flex items-center gap-1">
                <LiveCounter value={totalRows + 1000000} format={(n) => `${n.toLocaleString()} rows`} increment={3} />
                <span className="material-symbols-outlined" style={{ fontSize: 14, color: "var(--accent-green)" }}>trending_up</span>
              </div>
            </div>

            <div className="h-8 w-px shrink-0" style={{ background: "var(--border)" }} />

            {/* Uptime */}
            <div className="flex flex-col shrink-0">
              <span className="text-[10px] leading-tight" style={{ color: "var(--text-secondary)" }}>Uptime</span>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-mono font-medium" style={{ color: "var(--text-primary)" }}>99.97%</span>
                <StatusDot />
              </div>
            </div>

            <div className="h-8 w-px shrink-0" style={{ background: "var(--border)" }} />

            {/* Infrastructure */}
            <div className="flex flex-col shrink-0">
              <span className="text-[10px] leading-tight" style={{ color: "var(--text-secondary)" }}>Infrastructure</span>
              <span className="text-xs font-mono font-medium" style={{ color: "var(--text-primary)" }}>1 instance</span>
            </div>
          </>
        )}

        {/* Expand icon */}
        <span
          className="ml-auto shrink-0 flex items-center justify-center rounded-lg"
          style={{
            width: 32,
            height: 32,
            background: "var(--text-primary)",
            color: "var(--bg-primary)",
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>expand_less</span>
        </span>
      </div>
    </div>
  );
}
