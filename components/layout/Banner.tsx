"use client";

import { useState } from "react";
import { usePolling } from "@/hooks/usePolling";
import { POLLING_INTERVALS } from "@/lib/constants";
import { formatNumber } from "@/lib/format";

interface Stats {
  total_tokens: number;
  total_pools: number;
  tx_per_sec: number;
  total_rows: number;
}

export function Banner() {
  const [dismissed, setDismissed] = useState(false);

  const { data: stats } = usePolling<Stats>(
    () => fetch("/api/stats").then((r) => r.json()),
    POLLING_INTERVALS.STATS
  );

  if (dismissed) return null;

  const tokenCount = stats?.total_tokens ?? 3124;

  return (
    <div
      className="relative flex items-center justify-between px-4 py-2.5 text-sm border-b"
      style={{
        background: "var(--bg-secondary)",
        borderColor: "var(--border)",
        color: "var(--text-secondary)",
      }}
    >
      <p>
        <span style={{ color: "var(--accent-teal)" }}>Live DEX intelligence.</span>{" "}
        {formatNumber(tokenCount)} tokens. Streaming meets analytics — one TiDB Essential instance.
        No separate cache, queue, or analytics database.
      </p>
      <button
        onClick={() => setDismissed(true)}
        className="ml-4 p-1 rounded hover:opacity-80 shrink-0"
        style={{ color: "var(--text-muted)" }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M1 1l12 12M13 1L1 13" />
        </svg>
      </button>
    </div>
  );
}
