"use client";

import { useState, useEffect, useRef } from "react";
import { usePolling } from "@/hooks/usePolling";
import { POLLING_INTERVALS, EVENT_TYPE_CONFIG } from "@/lib/constants";
import { truncateAddress, formatUsd } from "@/lib/format";
import type { DefiEvent } from "@/lib/types";

interface EventTickerProps {
  onClick?: () => void;
}

function formatSecondsAgo(seconds: number | undefined): string {
  if (seconds === undefined || seconds === null || seconds < 0) return "now";
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

export function EventTicker({ onClick }: EventTickerProps) {
  const { data: events } = usePolling<DefiEvent[]>(
    () => fetch("/api/events?limit=10").then((r) => r.json()).then((d) => d.events),
    POLLING_INTERVALS.EVENTS
  );

  const items = events ?? [];

  // Track new event IDs for rainbow highlight
  const prevIdsRef = useRef<Set<number>>(new Set());
  const lastProcessedRef = useRef<DefiEvent[] | null>(null);
  const [newEventIds, setNewEventIds] = useState<Set<number>>(new Set());
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!events || events === lastProcessedRef.current) return;
    lastProcessedRef.current = events;
    const currentIds = new Set(events.map((e) => e.id));
    const prev = prevIdsRef.current;
    prevIdsRef.current = currentIds;
    // Skip first load — don't highlight everything
    if (prev.size === 0) return;
    const fresh = new Set<number>();
    for (const e of events) {
      if (!prev.has(e.id)) fresh.add(e.id);
    }
    if (fresh.size > 0) {
      setNewEventIds(fresh);
      // Pause scrolling to spotlight the new event
      setPaused(true);
      const timer = setTimeout(() => {
        setNewEventIds(new Set());
        setPaused(false);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [events]);

  if (items.length === 0) return null;

  return (
    <div
      className="border-b overflow-hidden cursor-pointer"
      style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}
      onClick={onClick}
    >
      <div className="flex items-center px-3 py-2 gap-2">
        <span className="flex items-center gap-1.5 shrink-0">
          <span className="w-2 h-2 rounded-full animate-pulse-dot" style={{ background: "var(--accent-green)" }} />
          <span className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>Live</span>
        </span>

        <div className="overflow-hidden flex-1">
          <div
            className={paused ? "flex gap-12 whitespace-nowrap" : "animate-ticker flex gap-12 whitespace-nowrap"}
            style={paused ? { transition: "transform 0.5s ease-out", transform: "translateX(0)" } : undefined}
          >
            {[...items, ...items].map((event, i) => {
              const config = EVENT_TYPE_CONFIG[event.event_type] || EVENT_TYPE_CONFIG.swap;
              const isNew = newEventIds.has(event.id);
              const secondsAgo = (event as unknown as Record<string, unknown>).seconds_ago as number | undefined;
              return (
                <span
                  key={`${event.id}-${i}`}
                  className={`flex items-center gap-1.5 text-xs${isNew ? " ticker-rainbow-glow" : ""}`}
                >
                  <img src={config.img} alt={config.label} className="w-4 h-4" />
                  <span className="font-mono" style={{ color: "var(--text-muted)" }}>
                    {truncateAddress(event.wallet_address)}
                  </span>
                  <span style={{ color: "var(--text-secondary)" }}>{event.description}</span>
                  {event.amount_usd > 0 && (
                    <span className="font-mono" style={{ color: config.color }}>
                      {formatUsd(Number(event.amount_usd))}
                    </span>
                  )}
                  <span
                    className="font-mono"
                    style={{ color: "var(--text-muted)", opacity: 0.6, fontSize: "10px" }}
                  >
                    {formatSecondsAgo(secondsAgo)}
                  </span>
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
