"use client";

import { useState, useRef, useEffect, useCallback } from "react";
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

const PAGE_SIZE = 30;

export function EventPanel() {
  const [tab, setTab] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const [history, setHistory] = useState<DefiEvent[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const prevEventIdsRef = useRef<Set<number>>(new Set());
  const lastProcessedRef = useRef<DefiEvent[] | null>(null);
  const [newEventIds, setNewEventIds] = useState<Set<number>>(new Set());

  const fetcher = useCallback(() => {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (tab === "swap") {
      params.set("type", "swap");
      params.set("min_amount", "10000");
    } else if (tab) {
      params.set("type", tab);
    }
    return fetch(`/api/events?${params}`).then((r) => r.json()).then((d) => d.events as DefiEvent[]);
  }, [tab]);

  const { data: liveEvents, loading } = usePolling(fetcher, POLLING_INTERVALS.EVENTS, true, tab);

  // Track newly appeared events for rainbow glow effect
  // Guard ref prevents strict-mode double-execution from breaking the comparison
  useEffect(() => {
    if (!liveEvents || liveEvents === lastProcessedRef.current) return;
    lastProcessedRef.current = liveEvents;
    const currentIds = new Set(liveEvents.map((e) => e.id));
    const prev = prevEventIdsRef.current;
    prevEventIdsRef.current = currentIds;
    if (prev.size === 0) return;
    const fresh = new Set<number>();
    for (const e of liveEvents) {
      if (!prev.has(e.id)) fresh.add(e.id);
    }
    if (fresh.size > 0) {
      setNewEventIds(fresh);
      const timer = setTimeout(() => setNewEventIds(new Set()), 4000);
      return () => clearTimeout(timer);
    }
  }, [liveEvents]);

  // Reset history when tab changes
  useEffect(() => {
    setHistory([]);
    setHasMore(true);
    prevEventIdsRef.current = new Set();
    setNewEventIds(new Set());
  }, [tab]);

  // Auto-scroll to top for new events (only when not paused)
  useEffect(() => {
    if (!paused && listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [liveEvents, paused]);

  // Merge live events with loaded history (dedup by id)
  const allEvents = (() => {
    const live = liveEvents ?? [];
    const seen = new Set(live.map((e) => e.id));
    const extra = history.filter((e) => !seen.has(e.id));
    return [...live, ...extra];
  })();

  // Load more events for infinite scroll
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(allEvents.length),
      });
      if (tab === "swap") {
        params.set("type", "swap");
        params.set("min_amount", "10000");
      } else if (tab) {
        params.set("type", tab);
      }
      const res = await fetch(`/api/events?${params}`);
      const data = await res.json();
      const older = (data.events as DefiEvent[]) ?? [];
      if (older.length < PAGE_SIZE) {
        setHasMore(false);
      }
      setHistory((prev) => {
        const ids = new Set(prev.map((e) => e.id));
        const fresh = older.filter((e) => !ids.has(e.id));
        return [...prev, ...fresh];
      });
    } catch {
      // ignore
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, allEvents.length, tab]);

  // Infinite scroll detection
  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    if (nearBottom) {
      loadMore();
    }
  }, [loadMore]);

  return (
    <div
      className="h-full border-l flex flex-col"
      style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b shrink-0" style={{ borderColor: "var(--border)" }}>
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
        className="flex-1 overflow-y-auto min-h-0"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onScroll={handleScroll}
      >
        {loading && allEvents.length === 0 ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="px-4 py-2.5 border-b" style={{ borderColor: "var(--border)" }}>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full animate-pulse" style={{ background: "var(--bg-hover)" }} />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 rounded animate-pulse" style={{ background: "var(--bg-hover)", width: "60%" }} />
                  <div className="h-3 rounded animate-pulse" style={{ background: "var(--bg-hover)", width: "85%" }} />
                </div>
              </div>
            </div>
          ))
        ) : (
          <>
            {allEvents.map((event) => (
              <EventItem key={event.id} event={event} isNew={newEventIds.has(event.id)} />
            ))}
            {loadingMore && (
              <div className="px-4 py-3 text-center text-xs" style={{ color: "var(--text-muted)" }}>
                Loading more...
              </div>
            )}
            {!hasMore && allEvents.length > 0 && (
              <div className="px-4 py-3 text-center text-xs" style={{ color: "var(--text-muted)" }}>
                No more events
              </div>
            )}
            {allEvents.length === 0 && !loading && (
              <div className="px-4 py-8 text-center text-xs" style={{ color: "var(--text-muted)" }}>
                No events yet...
              </div>
            )}
          </>
        )}
      </div>

    </div>
  );
}
