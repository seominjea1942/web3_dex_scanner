"use client";

import { useState, useRef, useCallback } from "react";

/* ── Preset chip data ────────────────────────────────────────── */
const PRESETS = [
  // ── Tier 1: Best TiDB demos (HTAP, TiFlash, distributed) ──
  {
    id: "realtime_agg",
    label: "volume by DEX",
    icon: "bar_chart",
    color: "var(--accent-green)",
    tooltip: "TiFlash columnar engine: full-table aggregation on 500K rows — no pre-computation",
    description: "Compare total trading volume across exchanges. See which DEX handles the most trades and money.",
    sql: `SELECT /*+ READ_FROM_STORAGE(TIFLASH[swap_transactions]) */
       dex,
       COUNT(*) AS trade_count,
       ROUND(SUM(usd_value), 2) AS total_volume,
       COUNT(DISTINCT trader_wallet) AS unique_wallets,
       ROUND(AVG(usd_value), 2) AS avg_trade_size
FROM swap_transactions
GROUP BY dex
ORDER BY total_volume DESC`,
  },
  {
    id: "hottest",
    label: "hottest pools",
    icon: "local_fire_department",
    color: "var(--accent-orange)",
    tooltip: "Distributed JOIN: swap_transactions × pools, GROUP BY + HAVING across shards",
    description: "Find which token pairs have the most trading activity right now. Great for discovering trending tokens early.",
    sql: `SELECT /*+ READ_FROM_STORAGE(TIFLASH[t]) */
       p.token_base_symbol, p.token_quote_symbol,
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
    id: "time_series",
    label: "trade timeline",
    icon: "timeline",
    color: "var(--accent-green)",
    tooltip: "Time-series analytics: GROUP BY hour on 500K+ swap transactions — TiFlash accelerated",
    description: "Hourly trading volume and trade count over the last 7 days. See when trading activity spikes across all pools.",
    sql: `SELECT /*+ READ_FROM_STORAGE(TIFLASH[swap_transactions]) */
       DATE(FROM_UNIXTIME(timestamp / 1000)) AS day,
       HOUR(FROM_UNIXTIME(timestamp / 1000)) AS hour,
       COUNT(*) AS trades,
       ROUND(SUM(usd_value), 2) AS volume,
       COUNT(DISTINCT pool_address) AS active_pools
FROM swap_transactions
WHERE timestamp > (UNIX_TIMESTAMP() * 1000 - 604800000)
GROUP BY day, hour
ORDER BY day DESC, hour DESC
LIMIT 30`,
  },
  // ── Tier 2: Good demos (MySQL compatibility, search) ──
  {
    id: "window_fn",
    label: "wallet ranking",
    icon: "leaderboard",
    color: "var(--accent-teal)",
    tooltip: "Advanced analytics: window functions (RANK, running totals) — MySQL-compatible",
    description: "Top pools ranked by volume with running cumulative total — window functions on real pool data.",
    sql: `SELECT token_base_symbol, token_quote_symbol, dex,
       ROUND(volume_24h, 2) AS volume_24h,
       RANK() OVER (ORDER BY volume_24h DESC) AS volume_rank,
       ROUND(SUM(volume_24h) OVER (
         ORDER BY volume_24h DESC
         ROWS UNBOUNDED PRECEDING
       ), 2) AS cumulative_volume,
       ROUND(price_change_24h, 2) AS change_24h
FROM pools
WHERE volume_24h > 0
ORDER BY volume_rank
LIMIT 20`,
  },
  {
    id: "search_events",
    label: "search events",
    icon: "search",
    color: "var(--accent-purple)",
    tooltip: "TiKV pushdown: LIKE filter on 100K+ event descriptions at storage layer",
    description: "Search on-chain events by keyword. Try changing 'whale' to 'liquidity', 'smart money', or any token name.",
    sql: `SELECT event_type, severity, dex,
       ROUND(usd_value, 2) AS usd_value,
       description,
       FROM_UNIXTIME(timestamp / 1000) AS event_time
FROM defi_events
WHERE description LIKE '%whale%'
ORDER BY timestamp DESC
LIMIT 20`,
  },
  // ── Tier 3: TiCI Vector Search demos ──
  {
    id: "similar_tokens",
    label: "similar tokens",
    icon: "hub",
    color: "var(--accent-blue)",
    tooltip: "TiCI Vector Search: find tokens with similar market behavior using VEC_COSINE_DISTANCE on 32-dim embeddings",
    description: "Find pools that trade like SOL/USDC — same volume pattern, momentum, and buy/sell pressure. Powered by TiDB vector index (HNSW).",
    sql: `-- TiCI: Find pools with similar market behavior to SOL/USDC
-- Uses 32-dim embeddings (volume, momentum, txn ratios)
SELECT
  pe.pair_name,
  pe.dex,
  ROUND(pe.volume_24h, 2) AS volume_24h,
  ROUND(pe.price_change_24h, 2) AS change_24h,
  ROUND(
    (1 - VEC_COSINE_DISTANCE(pe.embedding, (
      SELECT embedding FROM pattern_embeddings
      WHERE token_base_symbol = 'SOL'
      ORDER BY volume_24h DESC LIMIT 1
    ))) * 100, 2
  ) AS similarity_pct
FROM pattern_embeddings pe
WHERE pe.token_base_symbol != 'SOL'
ORDER BY VEC_COSINE_DISTANCE(pe.embedding, (
  SELECT embedding FROM pattern_embeddings
  WHERE token_base_symbol = 'SOL'
  ORDER BY volume_24h DESC LIMIT 1
))
LIMIT 15`,
  },
  {
    id: "whale",
    label: "whale trades",
    icon: "waves",
    color: "var(--accent-orange)",
    tooltip: "HTAP: query live transactional data with no ETL — 500K rows, instant results",
    description: "Find the biggest trades over $5K. Useful for spotting when large wallets are buying or selling.",
    sql: `SELECT /*+ READ_FROM_STORAGE(TIFLASH[swap_transactions]) */
       signature, trader_wallet,
       ROUND(usd_value, 2) AS usd_value,
       side, dex,
       FROM_UNIXTIME(timestamp / 1000) AS trade_time
FROM swap_transactions
WHERE usd_value > 5000
ORDER BY usd_value DESC
LIMIT 20`,
  },
  {
    id: "token_safety",
    label: "token safety",
    icon: "shield",
    color: "var(--accent-red, #EF4444)",
    tooltip: "Cross-table JOIN: safety scores × pool data — find suspicious tokens instantly",
    description: "Token safety scores cross-referenced with market cap — find suspicious tokens with low safety scores.",
    sql: `SELECT p.token_base_symbol AS symbol,
       p.dex,
       ROUND(p.market_cap) AS market_cap,
       ROUND(p.volume_24h, 2) AS volume_24h,
       ts.holder_count,
       ts.top10_holder_pct,
       ts.risk_score,
       CASE WHEN ts.is_mintable THEN 'YES' ELSE 'NO' END AS mintable,
       CASE WHEN ts.is_lp_burned THEN 'YES' ELSE 'NO' END AS lp_burned
FROM token_safety ts
JOIN pools p ON ts.token_address = p.token_base_address
ORDER BY ts.risk_score DESC
LIMIT 15`,
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
  onSchemaToggle?: () => void;
}

/* ── Component ───────────────────────────────────────────────── */
export function QueryChips({ activePreset, onSelect, onClear, disabled, onSchemaToggle }: QueryChipsProps) {
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

      {/* Schema toggle (mobile only) — left of trash */}
      {onSchemaToggle && (
        <>
          <button
            onClick={onSchemaToggle}
            className="shrink-0 flex items-center justify-center w-8 h-8 rounded-lg border transition-colors"
            style={{
              background: "var(--bg-card)",
              borderColor: "var(--border)",
              color: "var(--text-muted)",
            }}
            title="Toggle schema"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
              account_tree
            </span>
          </button>
          <div className="shrink-0 w-px h-5" style={{ background: "var(--border)" }} />
        </>
      )}

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
