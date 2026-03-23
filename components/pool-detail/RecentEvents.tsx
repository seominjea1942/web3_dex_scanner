"use client";

import { useEffect, useState } from "react";

interface PoolEvent {
  id: string;
  type: string;
  title: string;
  time_ago: string;
  dex: string;
}

interface RecentEventsProps {
  poolAddress: string;
}

const EVENT_ICONS: Record<string, { icon: string; color: string }> = {
  whale: { icon: "waves", color: "var(--accent-blue)" },
  large_trade: { icon: "waves", color: "var(--accent-blue)" },
  smart_money: { icon: "diamond", color: "var(--accent-teal)" },
  liquidity_add: { icon: "water_drop", color: "var(--accent-green)" },
  liquidity_remove: { icon: "water_drop", color: "var(--accent-orange)" },
  new_pool: { icon: "add_circle", color: "var(--accent-green)" },
};

export function RecentEvents({ poolAddress }: RecentEventsProps) {
  const [events, setEvents] = useState<PoolEvent[]>([]);
  const [total24h, setTotal24h] = useState(0);

  useEffect(() => {
    const fetchEvents = () => {
      fetch(`/api/pool/${poolAddress}/events?limit=7`)
        .then((r) => r.json())
        .then((data) => {
          setEvents(data.events || []);
          setTotal24h(data.total_24h || 0);
        })
        .catch(() => {});
    };
    fetchEvents();
    const iv = setInterval(fetchEvents, 5000);
    return () => clearInterval(iv);
  }, [poolAddress]);

  return (
    <div
      className="rounded-lg border overflow-hidden flex flex-col"
      style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Recent Events</span>
        </div>
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: "var(--bg-hover)", color: "var(--text-secondary)" }}>
          {total24h} events (24h)
        </span>
      </div>

      <div className="flex-1 overflow-auto" style={{ maxHeight: 340 }}>
        {events.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>
            No recent events
          </div>
        ) : events.map((ev) => {
          const cfg = EVENT_ICONS[ev.type] || { icon: "info", color: "var(--text-muted)" };
          return (
            <div
              key={ev.id}
              className="flex items-start gap-3 px-4 py-2.5 border-b transition-colors"
              style={{ borderColor: "var(--border)" }}
            >
              <span
                className="material-symbols-outlined mt-0.5 shrink-0"
                style={{ fontSize: 16, color: cfg.color }}
              >
                {cfg.icon}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium truncate" style={{ color: "var(--text-primary)" }}>
                  {ev.title}
                </div>
                <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                  {ev.time_ago} · {ev.dex}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer link */}
      <div className="px-4 py-2.5 border-t text-center" style={{ borderColor: "var(--border)" }}>
        <button
          onClick={() => {
            const query = encodeURIComponent(`SELECT event_type, severity, dex, ROUND(usd_value, 2) AS usd_value, description, FROM_UNIXTIME(timestamp / 1000) AS event_time FROM defi_events WHERE pool_address = '${poolAddress}' ORDER BY timestamp DESC LIMIT 50`);
            window.location.href = `/?page=sql-console&query=${query}`;
          }}
          className="flex items-center gap-1 text-xs mx-auto transition-colors"
          style={{ color: "var(--text-muted)" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent-teal)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
        >
          <span className="font-mono">&gt;_</span> Explore all events in SQL Console →
        </button>
      </div>
    </div>
  );
}
