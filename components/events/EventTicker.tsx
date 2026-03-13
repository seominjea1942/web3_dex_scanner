"use client";

import { usePolling } from "@/hooks/usePolling";
import { POLLING_INTERVALS, EVENT_TYPE_CONFIG } from "@/lib/constants";
import { truncateAddress, formatUsd } from "@/lib/format";
import type { DefiEvent } from "@/lib/types";

interface EventTickerProps {
  onClick?: () => void;
}

export function EventTicker({ onClick }: EventTickerProps) {
  const { data: events } = usePolling<DefiEvent[]>(
    () => fetch("/api/events?limit=10").then((r) => r.json()).then((d) => d.events),
    POLLING_INTERVALS.EVENTS
  );

  const items = events ?? [];

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
          <div className="animate-ticker flex gap-12 whitespace-nowrap">
            {[...items, ...items].map((event, i) => {
              const config = EVENT_TYPE_CONFIG[event.event_type] || EVENT_TYPE_CONFIG.swap;
              return (
                <span key={`${event.id}-${i}`} className="flex items-center gap-1.5 text-xs">
                  <span className="w-1 h-1 rounded-full shrink-0" style={{ background: "var(--text-muted)", opacity: 0.4 }} />
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
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
