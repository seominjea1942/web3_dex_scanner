"use client";

import { useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import type { Pool } from "@/lib/types";
import type { Breakpoint } from "@/hooks/useBreakpoint";
import { formatPrice, formatUsd, formatPercent, formatNumber, truncateAddress, formatAge } from "@/lib/format";
import { CopyButton } from "@/components/ui/CopyButton";

// Prefetch pool detail data on hover (fire-and-forget, deduped)
const prefetchedPools = new Set<string>();
function prefetchPool(poolId: string) {
  if (prefetchedPools.has(poolId)) return;
  prefetchedPools.add(poolId);
  // Prefetch pool detail + chart data in parallel
  fetch(`/api/pool/${poolId}`).catch(() => {});
  fetch(`/api/pool/${poolId}/ohlcv?interval=15m`).catch(() => {});
}

// DEX logos from DexScreener CDN
const DEX_LOGOS: Record<string, string> = {
  raydium: "https://dd.dexscreener.com/ds-data/dexes/raydium.png",
  orca: "https://dd.dexscreener.com/ds-data/dexes/orca.png",
  meteora: "https://dd.dexscreener.com/ds-data/dexes/meteora.png",
  jupiter: "https://dd.dexscreener.com/ds-data/dexes/jupiter.png",
  pumpswap: "https://dd.dexscreener.com/ds-data/dexes/pumpswap.png",
};

interface PoolRowProps {
  pool: Pool;
  rank: number;
  breakpoint: Breakpoint;
}

function PriceChange({ value }: { value: number }) {
  const color = value >= 0 ? "var(--accent-green)" : "var(--accent-red)";
  return (
    <span className="font-mono text-sm" style={{ color }}>
      {formatPercent(value)}
    </span>
  );
}

export function PoolRow({ pool, rank, breakpoint: bp }: PoolRowProps) {
  const router = useRouter();
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Prefetch on hover with 150ms delay (avoids prefetching on quick scroll-by)
  const handleMouseEnter = useCallback(() => {
    hoverTimerRef.current = setTimeout(() => prefetchPool(pool.id), 150);
  }, [pool.id]);
  const handleMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
  }, []);

  // Derive initials: prefer symbol, fall back to pair_label split, then "?"
  const [pairBase, pairQuote] = (pool.pair_label || "").split("/");
  const baseInitial = (pool.base_symbol || pairBase || "?")[0];
  const quoteInitial = (pool.quote_symbol || pairQuote || "?")[0];
  const hasDexLogo = !!(pool.dex_name && DEX_LOGOS[pool.dex_name.toLowerCase()]);

  return (
    <tr
      className="pool-row border-b transition-colors cursor-pointer"
      style={{ borderColor: "var(--border)" }}
      onClick={() => router.push(`/pool/${pool.id}`)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Rank */}
      <td className="px-4 py-3 text-sm font-mono sticky left-0 z-10" style={{ color: "var(--text-muted)", background: "var(--bg-primary)" }}>
        {rank}
      </td>

      {/* Token Cell */}
      <td className="px-3 py-3 sticky left-10 z-10" style={{ background: "var(--bg-primary)" }}>
        <div className="flex items-center gap-3">
          {/* Logo stack */}
          <div className="relative shrink-0" style={{ width: hasDexLogo ? 48 : 34, height: 32 }}>
            {/* Base token (large) */}
            <div
              className="logo-border w-7 h-7 rounded-full absolute top-0 left-0 z-10 flex items-center justify-center text-xs font-bold"
              style={{ background: "var(--accent-teal)", color: "#000", border: "2px solid var(--bg-primary)" }}
            >
              {baseInitial}
            </div>
            {pool.base_logo_url && (
              <img
                src={pool.base_logo_url}
                alt={pool.base_symbol || ""}
                className="logo-border w-7 h-7 rounded-full absolute top-0 left-0 z-10"
                style={{ border: "2px solid var(--bg-primary)" }}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            )}
            {/* Quote token — overlaps base token bottom-right */}
            <div
              className="logo-border w-5 h-5 rounded-full absolute z-20 flex items-center justify-center font-bold"
              style={{ bottom: 0, left: 14, background: "var(--text-muted)", color: "#000", border: "2px solid var(--bg-primary)", fontSize: "8px" }}
            >
              {quoteInitial}
            </div>
            {pool.quote_logo_url && (
              <img
                src={pool.quote_logo_url}
                alt={pool.quote_symbol || ""}
                className="logo-border w-5 h-5 rounded-full absolute z-20"
                style={{ bottom: 0, left: 14, border: "2px solid var(--bg-primary)" }}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            )}
            {/* DEX icon — same size as quote, overlaps quote by 2px */}
            {hasDexLogo && (
              <img
                src={DEX_LOGOS[pool.dex_name!.toLowerCase()]}
                alt={pool.dex_name || ""}
                className="logo-border w-5 h-5 rounded-full absolute z-30"
                style={{ bottom: 0, left: 28, border: "2px solid var(--bg-primary)", background: "var(--bg-primary)" }}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            )}
          </div>

          <div className="min-w-0">
            <div className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>
              {pool.pair_label || `${pool.base_symbol || "?"}/SOL`}
            </div>
            {bp !== "mobile" && (
              <div className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                {pool.base_name || pool.base_symbol || pairBase} · {pool.dex_name} · {pool.pool_type || "AMM"}
              </div>
            )}
          </div>
        </div>
      </td>

      {/* Price */}
      <td className="px-3 py-3 text-right font-mono text-sm" style={{ color: "var(--text-primary)" }}>
        {formatPrice(Number(pool.price_usd))}
      </td>

      {/* Price changes - desktop only */}
      {bp !== "mobile" && bp !== "tablet" && (
        <>
          <td className="px-3 py-3 text-right"><PriceChange value={Number(pool.price_change_5m)} /></td>
          <td className="px-3 py-3 text-right"><PriceChange value={Number(pool.price_change_1h)} /></td>
          <td className="px-3 py-3 text-right"><PriceChange value={Number(pool.price_change_6h)} /></td>
        </>
      )}

      {/* 24h change — always visible */}
      <td className="px-3 py-3 text-right">
        <PriceChange value={Number(pool.price_change_24h)} />
      </td>

      {/* Volume + Liquidity — always visible, scrollable on mobile */}
      <td className="px-3 py-3 text-right font-mono text-sm" style={{ color: "var(--text-secondary)" }}>
        {formatUsd(Number(pool.volume_24h))}
      </td>
      <td className="px-3 py-3 text-right font-mono text-sm" style={{ color: "var(--text-secondary)" }}>
        {formatUsd(Number(pool.liquidity_usd))}
      </td>

      {/* Desktop-only columns */}
      {bp === "desktop" && (
        <>
          <td className="px-3 py-3 text-right font-mono text-sm" style={{ color: "var(--text-secondary)" }}>
            {Number(pool.market_cap) > 0 ? formatUsd(Number(pool.market_cap)) : "-"}
          </td>
          <td className="px-3 py-3 text-right font-mono text-sm" style={{ color: "var(--text-secondary)" }}>
            {formatNumber(pool.makers || 0)}
          </td>
          <td className="px-3 py-3 text-right font-mono text-sm" style={{ color: "var(--text-secondary)" }}>
            {formatNumber(pool.txns_24h || 0)}
          </td>
          <td className="px-3 py-3 text-right text-sm" style={{ color: "var(--text-muted)" }}>
            {pool.pool_created_at ? formatAge(pool.pool_created_at) : "-"}
          </td>
          <td className="px-3 py-3 text-right">
            <CopyButton text={pool.id} />
          </td>
        </>
      )}

      {/* Tablet TXNS */}
      {bp === "tablet" && (
        <td className="px-3 py-3 text-right font-mono text-sm" style={{ color: "var(--text-secondary)" }}>
          {formatNumber(pool.txns_24h || 0)}
        </td>
      )}
    </tr>
  );
}
