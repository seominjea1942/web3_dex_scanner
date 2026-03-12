"use client";

interface FilterChipsProps {
  minVolume: number;
  maxAge: string | null;
  onMinVolumeChange: (v: number) => void;
  onMaxAgeChange: (v: string | null) => void;
}

const VOLUME_FILTERS = [
  { label: "Volume > $100K", value: 100000 },
  { label: "Volume > $1M", value: 1000000 },
];

export function FilterChips({
  minVolume,
  maxAge,
  onMinVolumeChange,
  onMaxAgeChange,
}: FilterChipsProps) {
  return (
    <div className="flex items-center gap-1.5">
      {VOLUME_FILTERS.map((f) => (
        <button
          key={f.value}
          onClick={() => onMinVolumeChange(minVolume === f.value ? 0 : f.value)}
          className="px-2.5 py-1 rounded-full text-xs border transition-colors"
          style={{
            borderColor: minVolume === f.value ? "var(--accent-teal)" : "var(--border)",
            background: minVolume === f.value ? "rgba(45, 212, 191, 0.1)" : "transparent",
            color: minVolume === f.value ? "var(--accent-teal)" : "var(--text-muted)",
          }}
        >
          {f.label}
        </button>
      ))}
      <button
        onClick={() => onMaxAgeChange(maxAge === "24h" ? null : "24h")}
        className="px-2.5 py-1 rounded-full text-xs border transition-colors"
        style={{
          borderColor: maxAge === "24h" ? "var(--accent-teal)" : "var(--border)",
          background: maxAge === "24h" ? "rgba(45, 212, 191, 0.1)" : "transparent",
          color: maxAge === "24h" ? "var(--accent-teal)" : "var(--text-muted)",
        }}
      >
        New (&lt;24h)
      </button>
    </div>
  );
}
