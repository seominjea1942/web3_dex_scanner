"use client";

import { useState, useEffect } from "react";
export function Banner() {
  const [dismissed, setDismissed] = useState(false);
  const [tokenCount, setTokenCount] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => r.json())
      .then((d) => setTokenCount(d.total_tokens))
      .catch(() => {});
  }, []);

  if (dismissed) return null;

  const formattedCount = tokenCount !== null
    ? tokenCount.toLocaleString()
    : "—";

  return (
    <div className="banner-upsell relative overflow-hidden border-b" style={{ borderColor: "var(--border)" }}>
      {/* Animated shimmer sweep */}
      <div className="banner-shimmer" />


      <div className="relative z-10 flex items-center justify-between px-4 py-2.5">
        <p className="text-sm">
          <span style={{ color: "var(--text-secondary)" }}>
            Live DEX intelligence. {formattedCount} tokens. Streaming meets analytics —{" "}
          </span>
          <span className="banner-gradient-text font-semibold">one TiDB Essential instance</span>
          <span style={{ color: "var(--text-secondary)" }}>
            . No separate cache, queue, or analytics database.
          </span>
        </p>
        <button
          onClick={() => setDismissed(true)}
          className="ml-4 p-1 rounded hover:opacity-80 shrink-0 transition-opacity"
          style={{ color: "var(--text-muted)" }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
        </button>
      </div>
    </div>
  );
}
