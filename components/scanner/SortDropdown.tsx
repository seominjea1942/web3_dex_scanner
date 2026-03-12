"use client";

import { useState, useRef, useEffect } from "react";
import type { SortField } from "@/lib/types";

interface SortDropdownProps {
  value: SortField;
  onChange: (v: SortField) => void;
}

const OPTIONS: { value: SortField; label: string }[] = [
  { value: "volume_24h", label: "Volume 24h" },
  { value: "liquidity_usd", label: "Liquidity" },
  { value: "price_change_24h", label: "Gainers" },
  { value: "trending", label: "Trending" },
];

export function SortDropdown({ value, onChange }: SortDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const current = OPTIONS.find((o) => o.value === value);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border"
        style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
      >
        Rank by: <span style={{ color: "var(--text-primary)" }}>{current?.label}</span>
        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>expand_more</span>
      </button>
      {open && (
        <div
          className="absolute right-0 mt-1 w-40 rounded-lg border py-1 z-40"
          style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
        >
          {OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-xs transition-colors"
              style={{
                color: value === opt.value ? "var(--accent-teal)" : "var(--text-secondary)",
                background: value === opt.value ? "rgba(45, 212, 191, 0.05)" : "transparent",
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
