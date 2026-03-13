"use client";

import type { FilterType } from "@/lib/types";

interface FilterChipsProps {
  activeFilter: FilterType;
  onFilterChange: (f: FilterType) => void;
}

const FILTERS: { key: FilterType & string; label: string; icon: string; activeColor: string; activeBg: string }[] = [
  {
    key: "hot",
    label: "Hot",
    icon: "local_fire_department",
    activeColor: "var(--accent-orange)",
    activeBg: "rgba(255, 141, 40, 0.15)",
  },
  {
    key: "gainers",
    label: "Gainers",
    icon: "trending_up",
    activeColor: "var(--accent-green)",
    activeBg: "rgba(48, 209, 88, 0.15)",
  },
  {
    key: "losers",
    label: "Losers",
    icon: "trending_down",
    activeColor: "var(--accent-red)",
    activeBg: "rgba(255, 66, 89, 0.15)",
  },
];

export function FilterChips({ activeFilter, onFilterChange }: FilterChipsProps) {
  return (
    <div className="flex items-center gap-1.5">
      {FILTERS.map((f) => {
        const isActive = activeFilter === f.key;
        return (
          <button
            key={f.key}
            onClick={() => onFilterChange(isActive ? null : f.key)}
            className="h-8 px-2.5 rounded-lg text-xs border transition-colors flex items-center gap-1"
            style={{
              borderColor: isActive ? f.activeColor : "var(--border)",
              background: isActive ? f.activeBg : "transparent",
              color: isActive ? f.activeColor : "var(--text-muted)",
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
              {f.icon}
            </span>
            {f.label}
          </button>
        );
      })}
    </div>
  );
}
