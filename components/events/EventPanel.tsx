"use client";

import { useState, useRef, useEffect } from "react";
import { usePolling } from "@/hooks/usePolling";
import { POLLING_INTERVALS } from "@/lib/constants";
import { EventItem } from "./EventItem";
import type { DefiEvent } from "@/lib/types";

const TABS = [
  { label: "All", value: null },
  { label: "Swap", value: "swap" },
  { label: "Liquidity", value: "liquidity" },
  { label: "New Pool", value: "new_pool" },
  { label: "Whale", value: "whale" },
];

export function EventPanel() {
  const [tab, setTab] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const fetcher = () => {
    const params = new URLSearchParams({ limit: "30" });
    if (tab === "swap") {
      params.set("type", "swap");
      params.set("min_amount", "10000");
    } else if (tab) {
      params.set("type", tab);
    }
    return fetch(`/api/events?${params}`).then((r) => r.json()).then((d) => d.events as DefiEvent[]);
  };

  const { data: events } = usePolling(fetcher, POLLING_INTERVALS.EVENTS);

  // Auto-scroll
  useEffect(() => {
    if (!paused && listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [events, paused]);

  return (
    <div
      className="w-80 shrink-0 border-l flex flex-col"
      style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full animate-pulse-dot" style={{ background: "var(--accent-green)" }} />
          <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>Live DeFi Events</span>
          <span className="ml-auto font-mono text-xs" style={{ color: "var(--text-muted)" }}>47 tx/sec</span>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-2">
          {TABS.map((t) => (
            <button
              key={t.label}
              onClick={() => setTab(t.value)}
              className="px-2 py-1 rounded text-xs transition-colors"
              style={{
                background: tab === t.value ? "var(--bg-hover)" : "transparent",
                color: tab === t.value ? "var(--text-primary)" : "var(--text-muted)",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Event list */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        {(events ?? []).map((event) => (
          <EventItem key={event.id} event={event} />
        ))}
        {(!events || events.length === 0) && (
          <div className="px-4 py-8 text-center text-xs" style={{ color: "var(--text-muted)" }}>
            No events yet...
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        className="px-4 py-2 text-xs border-t text-center"
        style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
      >
        Powered by <span style={{ color: "var(--accent-teal)" }}>TiDB Cloud</span> · 50K+ events/sec · 3.2ms P95
      </div>
    </div>
  );
}
