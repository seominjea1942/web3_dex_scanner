"use client";

import type { ScreenerFilters } from "@/lib/types";

interface Preset {
  key: string;
  label: string;
  icon: string;
  hint: string;
  color: string;
  bg: string;
  filters: Partial<ScreenerFilters>;
}

export const QUICK_PRESETS: Preset[] = [
  {
    key: "new_listings",
    label: "New Listings",
    icon: "fiber_new",
    hint: "< 48h old",
    color: "var(--accent-green)",
    bg: "rgba(48, 209, 88, 0.12)",
    filters: { age: { max: 48 } },
  },
  {
    key: "gem_hunt",
    label: "Gem Hunt",
    icon: "diamond",
    hint: "< 3d · liq > $10K",
    color: "var(--accent-purple)",
    bg: "rgba(219, 52, 242, 0.12)",
    filters: { age: { max: 72 }, liquidity: { min: 10_000 } },
  },
  {
    key: "high_volume",
    label: "High Volume",
    icon: "bar_chart",
    hint: "Vol > $500K / 24h",
    color: "var(--accent-blue)",
    bg: "rgba(99, 102, 241, 0.12)",
    filters: { volume: { min: 500_000 }, period: "24h" },
  },
  {
    key: "deep_liq",
    label: "Deep Liquidity",
    icon: "water_drop",
    hint: "Liq > $1M",
    color: "var(--accent-teal)",
    bg: "rgba(129, 140, 248, 0.12)",
    filters: { liquidity: { min: 1_000_000 } },
  },
  {
    key: "high_activity",
    label: "High Activity",
    icon: "electric_bolt",
    hint: "500+ txns / 24h",
    color: "var(--accent-orange)",
    bg: "rgba(255, 141, 40, 0.12)",
    filters: { txns: { min: 500 }, period: "24h" },
  },
];

interface QuickFilterPillsProps {
  activeKey: string | null;
  onSelect: (preset: Preset | null) => void;
}

export function QuickFilterPills({ activeKey, onSelect }: QuickFilterPillsProps) {
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5" style={{ scrollbarWidth: "none" }}>
      {QUICK_PRESETS.map((p) => {
        const isActive = activeKey === p.key;
        return (
          <button
            key={p.key}
            onClick={() => onSelect(isActive ? null : p)}
            title={p.hint}
            className="h-7 px-2.5 rounded-full text-xs border whitespace-nowrap flex items-center gap-1 transition-colors shrink-0"
            style={{
              borderColor: isActive ? p.color : "var(--border)",
              background: isActive ? p.bg : "transparent",
              color: isActive ? p.color : "var(--text-muted)",
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 13 }}>{p.icon}</span>
            {p.label}
          </button>
        );
      })}
    </div>
  );
}
