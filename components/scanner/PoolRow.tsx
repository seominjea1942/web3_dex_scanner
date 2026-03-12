"use client";

import type { Pool } from "@/lib/types";
import type { Breakpoint } from "@/hooks/useBreakpoint";
import { formatPrice, formatUsd, formatPercent, formatNumber, truncateAddress, formatAge } from "@/lib/format";
import { CopyButton } from "@/components/ui/CopyButton";

interface PoolRowProps {
  pool: Pool;
  rank: number;
  breakpoint: Breakpoint;
}

function PriceChange({ value }: { value: number }) {
  const color = value >= 0 ? "var(--accent-green)" : "var(--accent-red)";
  return (
    <span className="font-mono text-xs" style={{ color }}>
      {formatPercent(value)}
    </span>
  );
}

export function PoolRow({ pool, rank, breakpoint: bp }: PoolRowProps) {
  return (
    <tr
      className="border-b transition-colors cursor-pointer"
      style={{ borderColor: "var(--border)" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {/* Rank */}
      <td className="px-4 py-3 text-xs font-mono" style={{ color: "var(--text-muted)" }}>
        {rank}
      </td>

      {/* Token Cell */}
      <td className="px-2 py-3">
        <div className="flex items-center gap-2">
          {/* Logo stack */}
          <div className="relative w-10 h-8 shrink-0">
            {pool.base_logo_url ? (
              <img
                src={pool.base_logo_url}
                alt={pool.base_symbol || ""}
                className="w-7 h-7 rounded-full absolute top-0 left-0 z-10"
                style={{ border: "2px solid var(--bg-primary)" }}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <div
                className="w-7 h-7 rounded-full absolute top-0 left-0 z-10 flex items-center justify-center text-xs font-bold"
                style={{ background: "var(--accent-teal)", color: "#000", border: "2px solid var(--bg-primary)" }}
              >
                {(pool.base_symbol || "?")[0]}
              </div>
            )}
            {pool.quote_logo_url ? (
              <img
                src={pool.quote_logo_url}
                alt={pool.quote_symbol || ""}
                className="w-5 h-5 rounded-full absolute bottom-0 right-1"
                style={{ border: "2px solid var(--bg-primary)" }}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            ) : null}
          </div>

          <div className="min-w-0">
            <div className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>
              {pool.pair_label || `${pool.base_symbol || "?"}/SOL`}
            </div>
            {bp !== "mobile" && (
              <div className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                {pool.base_name || pool.base_symbol} · {pool.dex_name} · {pool.pool_type || "AMM"}
              </div>
            )}
          </div>
        </div>
      </td>

      {/* Price */}
      <td className="px-2 py-3 text-right font-mono text-sm" style={{ color: "var(--text-primary)" }}>
        {formatPrice(Number(pool.price_usd))}
      </td>

      {/* Price changes - desktop only */}
      {bp !== "mobile" && bp !== "tablet" && (
        <>
          <td className="px-2 py-3 text-right"><PriceChange value={Number(pool.price_change_5m)} /></td>
          <td className="px-2 py-3 text-right"><PriceChange value={Number(pool.price_change_1h)} /></td>
          <td className="px-2 py-3 text-right"><PriceChange value={Number(pool.price_change_6h)} /></td>
        </>
      )}

      {/* 24h or 5m change */}
      <td className="px-2 py-3 text-right">
        <PriceChange value={bp === "mobile" ? Number(pool.price_change_5m) : Number(pool.price_change_24h)} />
      </td>

      {/* Volume + Liquidity (tablet + desktop) */}
      {bp !== "mobile" && (
        <>
          <td className="px-2 py-3 text-right font-mono text-sm" style={{ color: "var(--text-secondary)" }}>
            {formatUsd(Number(pool.volume_24h))}
          </td>
          <td className="px-2 py-3 text-right font-mono text-sm" style={{ color: "var(--text-secondary)" }}>
            {formatUsd(Number(pool.liquidity_usd))}
          </td>
        </>
      )}

      {/* Desktop-only columns */}
      {bp === "desktop" && (
        <>
          <td className="px-2 py-3 text-right font-mono text-sm" style={{ color: "var(--text-secondary)" }}>
            {Number(pool.market_cap) > 0 ? formatUsd(Number(pool.market_cap)) : "-"}
          </td>
          <td className="px-2 py-3 text-right font-mono text-sm" style={{ color: "var(--text-secondary)" }}>
            {formatNumber(pool.makers || 0)}
          </td>
          <td className="px-2 py-3 text-right font-mono text-sm" style={{ color: "var(--text-secondary)" }}>
            {formatNumber(pool.txns_24h || 0)}
          </td>
          <td className="px-2 py-3 text-right text-xs" style={{ color: "var(--text-muted)" }}>
            {pool.pool_created_at ? formatAge(pool.pool_created_at) : "-"}
          </td>
          <td className="px-2 py-3 text-right">
            <CopyButton text={pool.id} />
          </td>
        </>
      )}

      {/* Tablet TXNS */}
      {bp === "tablet" && (
        <td className="px-2 py-3 text-right font-mono text-sm" style={{ color: "var(--text-secondary)" }}>
          {formatNumber(pool.txns_24h || 0)}
        </td>
      )}
    </tr>
  );
}
