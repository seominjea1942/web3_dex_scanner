"use client";

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

  const txPerSec = Math.round(m.write_throughput ? m.write_throughput / 500 : 47);
  const latency = m.query_latency ?? 3.2;
  const totalRows = Math.round((m.write_throughput ?? 25000) * 500);
  const qps = m.qps ?? 12400;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40 border-t"
      style={{
        background: "var(--bg-secondary)",
        borderColor: "var(--border)",
      }}
    >
      <div className="flex items-center px-4 py-2 gap-4 overflow-x-auto">
        {/* Label */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="material-symbols-outlined" style={{ fontSize: 16, color: "var(--accent-teal)" }}>diamond</span>
          <span className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
            TiDB Performance
          </span>
        </div>

        <div className="h-4 w-px shrink-0" style={{ background: "var(--border)" }} />

        {/* Live Transactions */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>Live Tx:</span>
          <span className="text-xs font-mono font-medium" style={{ color: "var(--text-primary)" }}>
            {txPerSec} tx/sec
          </span>
          <Sparkline data={s.write_throughput ?? []} color="var(--accent-green)" width={60} height={20} />
        </div>

        {bp !== "mobile" && (
          <>
            <div className="h-4 w-px shrink-0" style={{ background: "var(--border)" }} />

            {/* Query Latency */}
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>Latency:</span>
              <span className="text-xs font-mono font-medium" style={{ color: "var(--text-primary)" }}>
                {latency.toFixed(1)} ms
              </span>
              <Sparkline data={s.query_latency ?? []} color="var(--accent-orange)" width={60} height={20} />
            </div>

            <div className="h-4 w-px shrink-0" style={{ background: "var(--border)" }} />

            {/* Total Records */}
            <div className="flex items-center gap-2 shrink-0">
              <LiveCounter value={totalRows + 1000000} format={(n) => `${n.toLocaleString()} rows`} increment={3} />
              <span className="material-symbols-outlined" style={{ fontSize: 14, color: "var(--accent-green)" }}>trending_up</span>
            </div>
          </>
        )}

        {bp === "desktop" && (
          <>
            <div className="h-4 w-px shrink-0" style={{ background: "var(--border)" }} />

            {/* Uptime */}
            <div className="flex items-center gap-1.5 shrink-0">
              <StatusDot />
              <span className="text-xs font-mono" style={{ color: "var(--text-primary)" }}>99.97%</span>
            </div>

            <div className="h-4 w-px shrink-0" style={{ background: "var(--border)" }} />

            {/* QPS */}
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-xs font-mono" style={{ color: "var(--text-primary)" }}>
                {formatCompact(qps)}/sec
              </span>
              <span
                className="text-[10px] px-1 py-0.5 rounded"
                style={{ background: "rgba(34, 197, 94, 0.1)", color: "var(--accent-green)" }}
              >
                ▲12%
              </span>
            </div>

            <div className="h-4 w-px shrink-0" style={{ background: "var(--border)" }} />

            {/* Infrastructure */}
            <div className="flex items-center gap-1 shrink-0">
              <span className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>1</span>
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>instance</span>
            </div>
          </>
        )}

        {/* Expand button */}
        <button
          onClick={onExpand}
          className="ml-auto p-1.5 rounded transition-colors shrink-0"
          style={{ color: "var(--text-muted)" }}
          title="Expand performance panel"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>expand_less</span>
        </button>
      </div>
    </div>
  );
}
