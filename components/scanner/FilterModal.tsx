"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { RangeRow } from "./RangeRow";
import { QUICK_PRESETS } from "./QuickFilterPills";
import type { ScreenerFilters, ScreenerPeriod, RangeValue } from "@/lib/types";

const DEFAULT_FILTERS: ScreenerFilters = {
  age: {},
  liquidity: {},
  period: "24h",
  volume: {},
  txns: {},
  buys: {},
  sells: {},
};

const PERIODS: ScreenerPeriod[] = ["1h", "24h"];

interface FilterModalProps {
  open: boolean;
  onClose: () => void;
  onApply: (filters: ScreenerFilters) => void;
  current: ScreenerFilters;
}

export function FilterModal({ open, onClose, onApply, current }: FilterModalProps) {
  const [draft, setDraft] = useState<ScreenerFilters>(current);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Sync draft when modal opens
  useEffect(() => {
    if (open) { setDraft(current); setActivePreset(null); }
  }, [open, current]);

  const setRange = useCallback(
    (key: keyof ScreenerFilters, field: "min" | "max", value?: number) => {
      setActivePreset(null);
      setDraft((prev) => ({
        ...prev,
        [key]: { ...(prev[key] as RangeValue), [field]: value },
      }));
    },
    []
  );

  const handleReset = () => { setDraft(DEFAULT_FILTERS); setActivePreset(null); };

  const handleApply = () => {
    onApply(draft);
    onClose();
  };

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const period = draft.period;
  const is24h = period === "24h";

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 animate-fade-in"
        style={{ background: "rgba(0, 0, 0, 0.5)" }}
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div
        ref={panelRef}
        className="relative w-full max-w-[400px] h-full flex flex-col filter-drawer-slide-in"
        style={{
          background: "var(--bg-card)",
          borderLeft: "1px solid var(--border)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 shrink-0 border-b"
          style={{ borderColor: "var(--border)" }}
        >
          <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
            Filters
          </span>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-md flex items-center justify-center transition-colors"
            style={{ color: "var(--text-muted)" }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Quick presets */}
          <div className="flex flex-wrap gap-1.5 pb-3">
            {QUICK_PRESETS.map((p) => {
              const isActive = activePreset === p.key;
              return (
                <button
                  key={p.key}
                  title={p.hint}
                  onClick={() => {
                    if (isActive) {
                      setDraft(DEFAULT_FILTERS);
                      setActivePreset(null);
                    } else {
                      setDraft({ ...DEFAULT_FILTERS, ...p.filters });
                      setActivePreset(p.key);
                    }
                  }}
                  className="h-7 px-2.5 rounded-full text-xs border flex items-center gap-1 transition-colors"
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

          <Divider />

          {/* Section 1 — Token Attribute Ranges */}
          <RangeRow
            label="Age"
            unit="hrs"
            unitPosition="suffix"
            min={draft.age.min}
            max={draft.age.max}
            onChange={(f, v) => setRange("age", f, v)}
          />
          <RangeRow
            label="Liquidity"
            unit="$"
            unitPosition="prefix"
            min={draft.liquidity.min}
            max={draft.liquidity.max}
            onChange={(f, v) => setRange("liquidity", f, v)}
          />

          <Divider />

          {/* Section 2 — Period-Dependent Metrics */}
          <div className="py-2">
            <div
              className="inline-flex rounded-lg border p-0.5"
              style={{ borderColor: "var(--border)", background: "var(--bg-primary)" }}
            >
              {PERIODS.map((p) => (
                <button
                  key={p}
                  onClick={() => setDraft((prev) => ({ ...prev, period: p }))}
                  className="h-7 px-3 rounded-md text-xs font-medium transition-colors"
                  style={{
                    background: period === p ? "var(--bg-hover)" : "transparent",
                    color: period === p ? "var(--text-primary)" : "var(--text-muted)",
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <RangeRow
            label={`Volume (${period})`}
            unit="$"
            unitPosition="prefix"
            min={draft.volume.min}
            max={draft.volume.max}
            onChange={(f, v) => setRange("volume", f, v)}
          />

          {/* Txns / Buys / Sells only available for 24h */}
          {is24h ? (
            <>
              <RangeRow
                label="Txns (24h)"
                min={draft.txns.min}
                max={draft.txns.max}
                onChange={(f, v) => setRange("txns", f, v)}
              />
              <RangeRow
                label="Buys (24h)"
                min={draft.buys.min}
                max={draft.buys.max}
                onChange={(f, v) => setRange("buys", f, v)}
              />
              <RangeRow
                label="Sells (24h)"
                min={draft.sells.min}
                max={draft.sells.max}
                onChange={(f, v) => setRange("sells", f, v)}
              />
            </>
          ) : (
            <p className="text-xs py-2" style={{ color: "var(--text-muted)" }}>
              Txns / Buys / Sells are only available for the 24h period.
            </p>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between px-5 py-4 shrink-0 border-t"
          style={{ borderColor: "var(--border)" }}
        >
          <button
            onClick={handleReset}
            className="text-xs font-medium transition-colors"
            style={{ color: "var(--text-muted)" }}
          >
            Reset
          </button>
          <button
            onClick={handleApply}
            className="h-8 px-4 rounded-lg text-xs font-medium transition-colors"
            style={{
              background: "var(--accent-teal)",
              color: "#fff",
            }}
          >
            Apply
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function Divider() {
  return (
    <div className="my-2 border-b" style={{ borderColor: "var(--border)" }} />
  );
}
