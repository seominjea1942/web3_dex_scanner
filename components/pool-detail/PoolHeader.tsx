"use client";

import { formatPrice, formatPercent, formatUsd } from "@/lib/format";

export interface PoolHeaderData {
  pool_address: string;
  dex: string;
  base_token: { symbol: string; name: string; address: string; icon_url: string | null };
  quote_token: { symbol: string; name: string; address: string; icon_url: string | null };
  pair_name: string;
  current_price: number;
  price_changes: Record<string, number>;
  market_cap: number;
  volume_24h: number;
  liquidity: number;
  holders: number;
  events_24h: number;
  volumes?: Record<string, number>;
  txns?: Record<string, { buys: number; sells: number }>;
  pool_created_at?: string;
}

interface PoolHeaderTopProps {
  data: PoolHeaderData;
  timeRange: string;
}

const RANGE_TO_CHANGE_KEY: Record<string, string> = {
  "5m": "1h",
  "15m": "1h",
  "1H": "1h",
  "4H": "6h",
  "1D": "24h",
};

/** Top section: token identity + price + change badge */
export function PoolHeaderTop({ data, timeRange }: PoolHeaderTopProps) {
  const changeKey = RANGE_TO_CHANGE_KEY[timeRange] || "24h";
  const priceChange = data.price_changes[changeKey] ?? 0;
  const isPositive = priceChange >= 0;

  return (
    <div className="space-y-3">
      {/* Token identity row */}
      <div className="flex flex-wrap items-center gap-4">
        {/* Token icon */}
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 overflow-hidden"
          style={{ background: "var(--bg-hover)", color: "var(--text-primary)" }}
        >
          {data.base_token.icon_url ? (
            <img
              src={data.base_token.icon_url}
              alt={data.base_token.symbol}
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
                (e.target as HTMLImageElement).parentElement!.textContent = data.base_token.symbol[0];
              }}
            />
          ) : (
            data.base_token.symbol[0]
          )}
        </div>

        {/* Name + DEX */}
        <div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>
              {data.base_token.symbol} / {data.quote_token.symbol}
            </span>
            <span className="text-xs px-2 py-0.5 rounded" style={{ background: "var(--bg-hover)", color: "var(--text-muted)" }}>
              {data.dex}
            </span>
          </div>
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>
            {data.base_token.name}
          </div>
        </div>
      </div>

      {/* Price + change — own row, right above the time range selector */}
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold font-mono" style={{ color: "var(--text-primary)" }}>
          {formatPrice(data.current_price)}
        </span>
        <span
          className="text-sm font-semibold px-1.5 py-0.5 rounded"
          style={{
            color: isPositive ? "var(--accent-green)" : "var(--accent-red)",
            background: isPositive ? "rgba(48, 209, 88, 0.1)" : "rgba(255, 66, 89, 0.1)",
          }}
        >
          {formatPercent(priceChange)}
        </span>
      </div>
    </div>
  );
}

interface PoolHeaderStatsProps {
  data: PoolHeaderData;
}

/** Bottom section: stats row below the chart */
export function PoolHeaderStats({ data }: PoolHeaderStatsProps) {
  return (
    <div className="flex flex-wrap gap-6 text-xs px-1">
      {[
        { label: "MKT CAP", value: formatUsd(data.market_cap) },
        { label: "24H VOL", value: formatUsd(data.volume_24h) },
        { label: "LIQUIDITY", value: formatUsd(data.liquidity) },
        { label: "HOLDERS", value: data.holders?.toLocaleString() ?? "-" },
        { label: "EVENTS (24H)", value: String(data.events_24h) },
      ].map((stat) => (
        <div key={stat.label}>
          <div style={{ color: "var(--text-muted)" }}>{stat.label}</div>
          <div className="font-mono font-medium" style={{ color: "var(--text-primary)" }}>{stat.value}</div>
        </div>
      ))}
    </div>
  );
}
