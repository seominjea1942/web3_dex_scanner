"use client";

import { useEffect, useState } from "react";
import { formatUsd, formatPercent } from "@/lib/format";

interface PoolCard {
  pool_address: string;
  dex: string;
  pair_name: string;
  price: number;
  price_change_24h: number;
  market_cap: number;
  volume_24h: number;
  liquidity: number;
  volume_share: number;
}

interface LiquidityPoolsProps {
  tokenAddress: string;
  currentPoolAddress: string;
  onNavigate: (address: string) => void;
}

export function LiquidityPools({ tokenAddress, currentPoolAddress, onNavigate }: LiquidityPoolsProps) {
  const [pools, setPools] = useState<PoolCard[]>([]);
  const [tokenSymbol, setTokenSymbol] = useState("");

  useEffect(() => {
    if (!tokenAddress) return;
    fetch(`/api/token/${tokenAddress}/pools`)
      .then((r) => r.json())
      .then((data) => {
        setPools(data.pools || []);
        setTokenSymbol(data.token || "");
      })
      .catch(() => {});
  }, [tokenAddress]);

  if (pools.length === 0) return null;

  return (
    <div
      className="rounded-lg border p-4"
      style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <span className="material-symbols-outlined" style={{ fontSize: 18, color: "var(--accent-teal)" }}>account_balance</span>
        <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Liquidity Pools</span>
        <span
          className="text-xs font-semibold px-2 py-0.5 rounded-full"
          style={{ background: "var(--bg-hover)", color: "var(--text-secondary)" }}
        >
          {pools.length} pools
        </span>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
        {pools.map((pool) => {
          const isCurrent = pool.pool_address === currentPoolAddress;
          const isPositive = pool.price_change_24h >= 0;
          return (
            <button
              key={pool.pool_address}
              onClick={() => !isCurrent && onNavigate(pool.pool_address)}
              className="text-left rounded-lg border p-3 transition-colors relative"
              style={{
                background: "var(--bg-secondary)",
                borderColor: isCurrent ? "var(--accent-teal)" : "var(--border)",
                cursor: isCurrent ? "default" : "pointer",
              }}
            >
              {isCurrent && (
                <span
                  className="absolute top-2 right-2 text-xs font-bold px-1.5 py-0.5 rounded"
                  style={{ background: "var(--accent-teal)", color: "#fff" }}
                >
                  VIEWING
                </span>
              )}

              <div className="text-xs font-bold mb-0.5" style={{ color: "var(--text-primary)" }}>{pool.dex}</div>
              <div className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>{pool.pair_name}</div>

              <div className="flex items-baseline gap-1.5 mb-2">
                <span className="text-xs font-mono font-medium" style={{ color: "var(--text-primary)" }}>
                  {formatUsd(pool.price)}
                </span>
                <span className="text-xs" style={{ color: isPositive ? "var(--accent-green)" : "var(--accent-red)" }}>
                  {formatPercent(pool.price_change_24h)}
                </span>
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-3 gap-x-2 gap-y-1 text-xs">
                {[
                  { label: "MKT CAP", value: formatUsd(pool.market_cap) },
                  { label: "24H VOL", value: formatUsd(pool.volume_24h) },
                  { label: "LIQUIDITY", value: formatUsd(pool.liquidity) },
                ].map((s) => (
                  <div key={s.label}>
                    <div style={{ color: "var(--text-muted)" }}>{s.label}</div>
                    <div className="font-mono" style={{ color: "var(--text-secondary)" }}>{s.value}</div>
                  </div>
                ))}
              </div>

              {/* Volume share bar */}
              <div className="mt-2 h-1 rounded-full overflow-hidden" style={{ background: "var(--bg-hover)" }}>
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(pool.volume_share * 100, 100)}%`,
                    background: isCurrent ? "var(--accent-teal)" : "var(--text-secondary)",
                    opacity: isCurrent ? 1 : 0.7,
                  }}
                />
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
        relative 24h volume
      </div>
    </div>
  );
}
