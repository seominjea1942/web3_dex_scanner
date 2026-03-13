"use client";

import { useState, useRef, useEffect } from "react";
import { usePolling } from "@/hooks/usePolling";
import { POLLING_INTERVALS, EVENT_TYPE_CONFIG } from "@/lib/constants";
import { truncateAddress, formatUsd } from "@/lib/format";
import type { DefiEvent } from "@/lib/types";

const FILTER_OPTIONS = [
  { label: "All", value: null },
  { label: "Swap", value: "swap" },
  { label: "Liquidity", value: "liquidity" },
  { label: "New Pool", value: "new_pool" },
  { label: "Whale", value: "whale" },
  { label: "Smart Money", value: "smart_money" },
];

function formatSecondsAgo(seconds: number | undefined): string {
  if (seconds === undefined || seconds === null || seconds < 0) return "just now";
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

interface MobileEventSheetProps {
  onClose: () => void;
}

export function MobileEventSheet({ onClose }: MobileEventSheetProps) {
  const [filter, setFilter] = useState<string | null>(null);
  const [showFilter, setShowFilter] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const prevEventIdsRef = useRef<Set<number>>(new Set());
  const lastProcessedRef = useRef<DefiEvent[] | null>(null);
  const [newEventIds, setNewEventIds] = useState<Set<number>>(new Set());

  const fetcher = () => {
    const params = new URLSearchParams({ limit: "50" });
    if (filter === "swap") {
      params.set("type", "swap");
      params.set("min_amount", "10000");
    } else if (filter) {
      params.set("type", filter);
    }
    return fetch(`/api/events?${params}`).then((r) => r.json()).then((d) => d.events as DefiEvent[]);
  };

  const { data: events } = usePolling(fetcher, POLLING_INTERVALS.EVENTS);

  // Track newly appeared events for rainbow glow effect
  useEffect(() => {
    if (!events || events === lastProcessedRef.current) return;
    lastProcessedRef.current = events;
    const currentIds = new Set(events.map((e) => e.id));
    const prev = prevEventIdsRef.current;
    prevEventIdsRef.current = currentIds;
    if (prev.size === 0) return;
    const fresh = new Set<number>();
    for (const e of events) {
      if (!prev.has(e.id)) fresh.add(e.id);
    }
    if (fresh.size > 0) {
      setNewEventIds(fresh);
      const timer = setTimeout(() => setNewEventIds(new Set()), 4000);
      return () => clearTimeout(timer);
    }
  }, [events]);

  // Close filter dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setShowFilter(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header: back arrow, centered title, filter */}
      <div
        className="flex items-center px-4 py-3 border-b shrink-0"
        style={{ borderColor: "var(--border)" }}
      >
        <button
          onClick={onClose}
          className="p-1 -ml-1 rounded"
          style={{ color: "var(--text-primary)" }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 22 }}>arrow_back</span>
        </button>
        <span
          className="flex-1 text-center text-sm font-medium"
          style={{ color: "var(--text-primary)" }}
        >
          Live DeFi Events
        </span>
        <div className="relative" ref={filterRef}>
          <button
            onClick={() => setShowFilter(!showFilter)}
            className="p-1 -mr-1 rounded"
            style={{ color: filter ? "var(--accent-teal)" : "var(--text-muted)" }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 22 }}>tune</span>
          </button>
          {showFilter && (
            <div
              className="absolute right-0 mt-1 w-36 rounded-lg border py-1 z-50"
              style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
            >
              {FILTER_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => { setFilter(opt.value); setShowFilter(false); }}
                  className="w-full text-left px-3 py-2 text-xs transition-colors"
                  style={{
                    color: filter === opt.value ? "var(--accent-teal)" : "var(--text-secondary)",
                    background: filter === opt.value ? "rgba(45, 212, 191, 0.05)" : "transparent",
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Event list */}
      <div ref={listRef} className="flex-1 overflow-y-auto">
        {(events ?? []).map((event) => (
          <MobileEventItem key={event.id} event={event} isNew={newEventIds.has(event.id)} />
        ))}
        {(!events || events.length === 0) && (
          <div className="px-4 py-12 text-center text-xs" style={{ color: "var(--text-muted)" }}>
            No events yet...
          </div>
        )}
      </div>
    </div>
  );
}

function MobileEventItem({ event, isNew }: { event: DefiEvent; isNew?: boolean }) {
  const config = EVENT_TYPE_CONFIG[event.event_type] || EVENT_TYPE_CONFIG.swap;
  const secondsAgo = (event as unknown as Record<string, unknown>).seconds_ago as number;

  return (
    <div
      className={`px-4 py-3.5 border-b${isNew ? " event-rainbow-glow" : ""}`}
      style={{ borderColor: "var(--border)" }}
    >
      <div className="flex items-center gap-3">
        {/* Icon */}
        <div className="shrink-0">
          <img
            src={config.img}
            alt={config.label}
            className="w-8 h-8"
          />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm leading-snug" style={{ color: "var(--text-primary)" }}>
              <span className="font-mono">{truncateAddress(event.wallet_address)}</span>
              {"  "}
              {event.description}
            </p>
            <span className="text-[11px] shrink-0 mt-0.5" style={{ color: "var(--text-muted)" }}>
              {formatSecondsAgo(secondsAgo)}
            </span>
          </div>
          <div className="mt-1.5">
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium"
              style={{ background: config.bgColor, color: config.color }}
            >
              {config.label}
              <span className="material-symbols-outlined" style={{ fontSize: 12 }}>info</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
