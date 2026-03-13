"use client";

import type { DefiEvent } from "@/lib/types";
import { EVENT_TYPE_CONFIG } from "@/lib/constants";
import { truncateAddress } from "@/lib/format";
import { toast } from "@/components/ui/Toast";

function formatSecondsAgo(seconds: number | undefined): string {
  if (seconds === undefined || seconds === null || seconds < 0) return "just now";
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

interface EventItemProps {
  event: DefiEvent;
  isNew?: boolean;
}

export function EventItem({ event, isNew }: EventItemProps) {
  const config = EVENT_TYPE_CONFIG[event.event_type] || EVENT_TYPE_CONFIG.swap;

  return (
    <div
      className={`px-4 py-2.5 border-b transition-colors cursor-pointer${isNew ? " animate-fade-in event-rainbow-glow" : ""}`}
      style={{ borderColor: "var(--border)" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      onClick={() => toast("Event detail page coming soon 🚀")}
    >
      <div className="flex items-center gap-2">
        {/* Event type icon */}
        <div className="shrink-0">
          <img
            src={config.img}
            alt={config.label}
            className="w-6 h-6"
          />
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
            <span className="text-[10px] ml-auto shrink-0" style={{ color: "var(--text-muted)" }}>
              {formatSecondsAgo((event as unknown as Record<string, unknown>).seconds_ago as number)}
            </span>
          </div>
          <p className="text-xs mt-0.5 truncate" style={{ color: "var(--text-primary)" }}>
            {event.description}
          </p>
        </div>
      </div>
    </div>
  );
}
