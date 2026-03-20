"use client";

import { useState, useRef, useCallback } from "react";

/* ── Preset chip data ────────────────────────────────────────── */
const PRESETS = [
  {
    id: "whale",
    label: "whale trades",
    icon: "waves",
    color: "var(--accent-blue)",
    tooltip: "HTAP: query live transactional data with no ETL — 7M rows, instant results",
    description: "Large trades over $5K — spot unusual buying or selling activity from major wallets.",
    sql: `SELECT signature, trader_wallet,
       ROUND(usd_value, 2) AS usd_value,
       side, dex,
       FROM_UNIXTIME(timestamp / 1000) AS trade_time
FROM swap_transactions
WHERE usd_value > 5000
ORDER BY usd_value DESC
LIMIT 20`,
  },
  {
    id: "realtime_agg",
    label: "volume by DEX",
    icon: "bar_chart",
    color: "var(--accent-green)",
    tooltip: "TiFlash columnar engine: full-table aggregation on 7M rows — no pre-computation",
    description: "Trading volume breakdown by exchange — see which DEX is getting the most action.",
    sql: `SELECT dex,
       COUNT(*) AS trade_count,
       ROUND(SUM(usd_value), 2) AS total_volume,
       COUNT(DISTINCT trader_wallet) AS unique_wallets,
       ROUND(AVG(usd_value), 2) AS avg_trade_size
FROM swap_transactions
GROUP BY dex
ORDER BY total_volume DESC`,
  },
  {
    id: "window_fn",
    label: "wallet ranking",
    icon: "leaderboard",
    color: "var(--accent-teal)",
    tooltip: "Advanced analytics: window functions (RANK, running totals) — MySQL-compatible",
    description: "Top wallets ranked by total trading volume with cumulative market share — find out who dominates the market.",
    sql: `SELECT address, label, trade_count,
       ROUND(total_volume, 2) AS total_volume,
       RANK() OVER (ORDER BY total_volume DESC) AS volume_rank,
       ROUND(SUM(total_volume) OVER (
         ORDER BY total_volume DESC
         ROWS UNBOUNDED PRECEDING
       ), 2) AS cumulative_volume
FROM wallet_profiles
WHERE trade_count >= 5
ORDER BY volume_rank
LIMIT 20`,
  },
  {
    id: "hottest",
    label: "hottest pools",
    icon: "local_fire_department",
    color: "var(--accent-orange)",
    tooltip: "Distributed JOIN: swap_transactions × pools, GROUP BY + HAVING across shards",
    description: "Pools with the most trading activity — catch momentum early before it shows up on charts.",
    sql: `SELECT p.token_base_symbol, p.token_quote_symbol,
       p.dex,
       COUNT(*) AS tx_count,
       ROUND(SUM(t.usd_value), 2) AS volume,
       COUNT(DISTINCT t.trader_wallet) AS traders
FROM swap_transactions t
JOIN pools p ON t.pool_address = p.address
GROUP BY p.address, p.token_base_symbol,
         p.token_quote_symbol, p.dex
HAVING tx_count > 100
ORDER BY volume DESC
LIMIT 15`,
  },
  {
    id: "search_events",
    label: "search events",
    icon: "search",
    color: "var(--accent-purple)",
    tooltip: "Full scan with LIKE on 400K+ rows — TiKV pushdown filters at storage layer",
    description: "Search DeFi events by keyword — find whale movements, liquidity changes, and smart money activity.",
    sql: `SELECT event_type, severity, dex,
       ROUND(usd_value, 2) AS usd_value,
       description,
       FROM_UNIXTIME(timestamp / 1000) AS event_time
FROM defi_events
WHERE description LIKE '%whale%'
ORDER BY timestamp DESC
LIMIT 20`,
  },
  {
    id: "smart_money",
    label: "smart money",
    icon: "diamond",
    color: "var(--accent-red, #EF4444)",
    tooltip: "Multi-condition filter: composite WHERE + ORDER on pre-aggregated profiles",
    description: "Wallets that are consistently buying with high conviction — track accumulation patterns from experienced traders.",
    sql: `SELECT address, label,
       trade_count, buy_count, sell_count,
       ROUND(total_volume, 2) AS total_volume,
       pools_traded,
       ROUND(avg_trade_size, 2) AS avg_trade_size
FROM wallet_profiles
WHERE pools_traded >= 3
  AND trade_count >= 10
ORDER BY total_volume DESC
LIMIT 15`,
  },
  {
    id: "time_series",
    label: "price OHLCV",
    icon: "timeline",
    color: "var(--accent-green)",
    tooltip: "Time-series analytics: GROUP BY date on 2.8M candles — TiFlash accelerated",
    description: "Price candlestick data (Open, High, Low, Close, Volume) for any pool — the raw data behind every chart.",
    sql: `SELECT DATE(FROM_UNIXTIME(ph.timestamp / 1000)) AS day,
       ROUND(AVG(ph.close), 6) AS avg_close,
       ROUND(MAX(ph.high), 6) AS day_high,
       ROUND(MIN(ph.low), 6) AS day_low,
       ROUND(SUM(ph.volume), 2) AS total_volume,
       COUNT(*) AS candles
FROM price_history ph
WHERE ph.pool_address = (
  SELECT address FROM pools LIMIT 1
)
GROUP BY day
ORDER BY day DESC
LIMIT 20`,
  },
] as const;

/** Look up a preset's description + metadata by id */
export function getPresetInfo(id: string) {
  const p = PRESETS.find((p) => p.id === id);
  if (!p) return null;
  return { description: p.description, icon: p.icon, color: p.color, label: p.label };
}

/* ── Props ───────────────────────────────────────────────────── */
interface QueryChipsProps {
  activePreset: string | null;
  onSelect: (id: string, sql: string) => void;
  onClear: () => void;
  disabled?: boolean;
}

/* ── Component ───────────────────────────────────────────────── */
export function QueryChips({ activePreset, onSelect, onClear, disabled }: QueryChipsProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const hideTimeout = useRef<ReturnType<typeof setTimeout>>();

  const handleMouseEnter = useCallback((e: React.MouseEvent, id: string) => {
    clearTimeout(hideTimeout.current);
    const btn = e.currentTarget.getBoundingClientRect();
    setTooltipPos({
      x: btn.left + btn.width / 2,
      y: btn.bottom + 8,
    });
    setHoveredId(id);
  }, []);

  const handleMouseLeave = useCallback(() => {
    hideTimeout.current = setTimeout(() => setHoveredId(null), 100);
  }, []);

  const hoveredPreset = PRESETS.find((p) => p.id === hoveredId);

  return (
    <div
      className="query-chips-row flex items-center gap-2 overflow-x-auto flex-nowrap py-1"
      style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
    >
      {/* Hide webkit scrollbar */}
      <style>{`.query-chips-row::-webkit-scrollbar { display: none; }`}</style>

      {/* Clear / blank query button */}
      <button
        onClick={onClear}
        disabled={disabled}
        className="shrink-0 flex items-center justify-center w-8 h-8 rounded-full border transition-colors"
        style={{
          background: "var(--bg-card)",
          borderColor: "var(--border)",
          color: "var(--text-muted)",
          opacity: disabled ? 0.6 : 1,
        }}
        title="Clear query"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
          delete
        </span>
      </button>

      {/* Preset chips */}
      {PRESETS.map((preset) => {
        const isActive = activePreset === preset.id;
        return (
          <button
            key={preset.id}
            onClick={() => onSelect(preset.id, preset.sql)}
            onMouseEnter={(e) => handleMouseEnter(e, preset.id)}
            onMouseLeave={handleMouseLeave}
            disabled={disabled}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs transition-colors"
            style={{
              background: isActive ? "var(--bg-hover)" : "var(--bg-card)",
              borderColor: isActive ? preset.color : "var(--border)",
              color: isActive ? preset.color : "var(--text-secondary)",
              opacity: disabled ? 0.6 : 1,
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 14, color: preset.color }}
            >
              {preset.icon}
            </span>
            {preset.label}
          </button>
        );
      })}

      {/* Custom styled tooltip — fixed to viewport so overflow doesn't clip */}
      {hoveredPreset && (
        <div
          className="fixed z-[9999] pointer-events-none"
          style={{
            left: tooltipPos.x,
            top: tooltipPos.y,
            transform: "translateX(-50%)",
          }}
        >
          {/* Arrow — outer (border) + inner (fill) */}
          <div style={{ position: "relative", width: 14, height: 7, margin: "0 auto", marginBottom: -1 }}>
            {/* Outer arrow (border color) */}
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: 0,
                height: 0,
                borderLeft: "7px solid transparent",
                borderRight: "7px solid transparent",
                borderBottom: "7px solid var(--border)",
              }}
            />
            {/* Inner arrow (fill color) — 1px smaller to show border */}
            <div
              style={{
                position: "absolute",
                top: 1,
                left: 1,
                width: 0,
                height: 0,
                borderLeft: "6px solid transparent",
                borderRight: "6px solid transparent",
                borderBottom: "6px solid var(--bg-card)",
              }}
            />
          </div>
          {/* Tooltip body */}
          <div
            className="rounded-lg px-3 py-2.5 shadow-lg"
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border)",
              maxWidth: 260,
              minWidth: 180,
            }}
          >
            {/* Header with icon + label */}
            <div className="flex items-center gap-1.5 mb-1">
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 13, color: hoveredPreset.color }}
              >
                {hoveredPreset.icon}
              </span>
              <span
                className="text-[11px] font-semibold uppercase tracking-wide"
                style={{ color: hoveredPreset.color }}
              >
                {hoveredPreset.label}
              </span>
            </div>
            {/* Description */}
            <div
              className="text-[11px] leading-relaxed"
              style={{ color: "var(--text-secondary)" }}
            >
              {hoveredPreset.tooltip}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
