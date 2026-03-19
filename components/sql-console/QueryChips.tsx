"use client";

/* ── Preset chip data ────────────────────────────────────────── */
const PRESETS = [
  {
    id: "whale",
    label: "top whale trades",
    icon: "waves",
    color: "var(--accent-blue)",
    sql: `SELECT t.signature, t.trader_wallet, t.usd_value,
       t.side, p.token_base_symbol, p.token_quote_symbol, p.dex,
       FROM_UNIXTIME(t.timestamp / 1000) AS trade_time
FROM swap_transactions t
JOIN pools p ON t.pool_address = p.address
WHERE t.timestamp > (UNIX_TIMESTAMP() - 86400) * 1000
  AND t.usd_value > 10000
ORDER BY t.usd_value DESC
LIMIT 20`,
  },
  {
    id: "smart_money",
    label: "smart money wallets",
    icon: "diamond",
    color: "var(--accent-teal)",
    sql: `SELECT trader_wallet,
       COUNT(*) AS total_trades,
       SUM(CASE WHEN side = 'buy' THEN 1 ELSE 0 END) AS buys,
       SUM(CASE WHEN side = 'sell' THEN 1 ELSE 0 END) AS sells,
       ROUND(SUM(usd_value), 2) AS total_volume
FROM swap_transactions
WHERE timestamp > (UNIX_TIMESTAMP() - 7 * 86400) * 1000
GROUP BY trader_wallet
HAVING total_trades >= 10 AND buys > sells * 2
ORDER BY total_volume DESC
LIMIT 20`,
  },
  {
    id: "volume_dex",
    label: "volume by DEX",
    icon: "bar_chart",
    color: "var(--accent-green)",
    sql: `SELECT p.dex,
       COUNT(*) AS trade_count,
       ROUND(SUM(t.usd_value), 2) AS total_volume,
       COUNT(DISTINCT t.trader_wallet) AS unique_wallets
FROM swap_transactions t
JOIN pools p ON t.pool_address = p.address
WHERE t.timestamp > (UNIX_TIMESTAMP() - 7 * 86400) * 1000
GROUP BY p.dex
ORDER BY total_volume DESC`,
  },
  {
    id: "hottest",
    label: "hottest pools",
    icon: "local_fire_department",
    color: "var(--accent-orange)",
    sql: `SELECT p.token_base_symbol, p.token_quote_symbol, p.dex,
       COUNT(*) AS tx_count,
       ROUND(SUM(t.usd_value), 2) AS volume,
       COUNT(DISTINCT t.trader_wallet) AS traders
FROM swap_transactions t
JOIN pools p ON t.pool_address = p.address
WHERE t.timestamp > (UNIX_TIMESTAMP() - 3600) * 1000
GROUP BY t.pool_address, p.token_base_symbol, p.token_quote_symbol, p.dex
ORDER BY tx_count DESC
LIMIT 15`,
  },
  {
    id: "search_events",
    label: "search events",
    icon: "search",
    color: "var(--accent-purple)",
    sql: `SELECT event_type, severity, dex, usd_value,
       description,
       FROM_UNIXTIME(timestamp / 1000) AS event_time
FROM defi_events
WHERE description LIKE '%whale%'
ORDER BY timestamp DESC
LIMIT 20`,
  },
  {
    id: "dumpers",
    label: "top dumpers",
    icon: "trending_down",
    color: "var(--accent-red, #EF4444)",
    sql: `SELECT trader_wallet,
       COUNT(*) AS sell_count,
       ROUND(SUM(usd_value), 2) AS total_sold
FROM swap_transactions
WHERE side = 'sell'
  AND timestamp > (UNIX_TIMESTAMP() - 86400) * 1000
GROUP BY trader_wallet
ORDER BY total_sold DESC
LIMIT 20`,
  },
  {
    id: "tx_over_time",
    label: "TX over time",
    icon: "timeline",
    color: "var(--accent-green)",
    sql: `SELECT FROM_UNIXTIME(FLOOR(timestamp / 3600000) * 3600) AS hour,
       COUNT(*) AS tx_count,
       ROUND(SUM(usd_value), 2) AS volume
FROM swap_transactions
WHERE timestamp > (UNIX_TIMESTAMP() - 86400) * 1000
GROUP BY FLOOR(timestamp / 3600000)
ORDER BY hour DESC`,
  },
] as const;

/* ── Props ───────────────────────────────────────────────────── */
interface QueryChipsProps {
  activePreset: string | null;
  onSelect: (id: string, sql: string) => void;
  onClear: () => void;
  disabled?: boolean;
}

/* ── Component ───────────────────────────────────────────────── */
export function QueryChips({ activePreset, onSelect, onClear, disabled }: QueryChipsProps) {
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
    </div>
  );
}
