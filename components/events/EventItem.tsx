"use client";

import type { DefiEvent } from "@/lib/types";
import { EVENT_TYPE_CONFIG } from "@/lib/constants";
import { truncateAddress, formatUsd } from "@/lib/format";

function formatSecondsAgo(seconds: number | undefined): string {
  if (seconds === undefined || seconds === null || seconds < 0) return "just now";
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

interface EventItemProps {
  event: DefiEvent;
}

export function EventItem({ event }: EventItemProps) {
  const config = EVENT_TYPE_CONFIG[event.event_type] || EVENT_TYPE_CONFIG.swap;

  return (
    <div
      className="px-4 py-2.5 border-b transition-colors animate-fade-in"
      style={{ borderColor: "var(--border)" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <div className="flex items-start gap-2">
        {/* Token logo or emoji */}
        <div className="shrink-0 mt-0.5">
          {event.token_logo_url ? (
            <img
              src={event.token_logo_url}
              alt={event.token_symbol}
              className="w-6 h-6 rounded-full"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <span className="text-base">{config.emoji}</span>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span
              className="px-1.5 py-0.5 rounded text-[10px] font-medium"
              style={{
                background: config.bgColor,
                color: config.color,
              }}
            >
              {config.label}
            </span>
            <span className="font-mono text-xs" style={{ color: "var(--text-muted)" }}>
              {truncateAddress(event.wallet_address)}
            </span>
          </div>
          <p className="text-xs mt-0.5 truncate" style={{ color: "var(--text-secondary)" }}>
            {event.description}
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            {event.amount_usd > 0 && (
              <span className="font-mono text-xs" style={{ color: "var(--text-primary)" }}>
                {formatUsd(Number(event.amount_usd))}
              </span>
            )}
            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              {formatSecondsAgo((event as Record<string, unknown>).seconds_ago as number)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
