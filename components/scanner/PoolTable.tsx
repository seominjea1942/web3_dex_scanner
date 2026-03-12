"use client";

import { useState, useCallback } from "react";
import { usePolling } from "@/hooks/usePolling";
import { useBreakpoint } from "@/hooks/useBreakpoint";
import { POLLING_INTERVALS } from "@/lib/constants";
import { PoolRow } from "./PoolRow";
import { SearchBar } from "./SearchBar";
import { FilterChips } from "./FilterChips";
import { SortDropdown } from "./SortDropdown";
import type { Pool, SortField } from "@/lib/types";

interface PoolsResponse {
  pools: Pool[];
  total: number;
  page: number;
  totalPages: number;
}

export function PoolTable() {
  const bp = useBreakpoint();
  const [sort, setSort] = useState<SortField>("volume_24h");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [minVolume, setMinVolume] = useState(0);
  const [maxAge, setMaxAge] = useState<string | null>(null);

  const fetcher = useCallback(() => {
    const params = new URLSearchParams({
      sort,
      order: "desc",
      page: String(page),
      limit: "20",
    });
    if (search) params.set("search", search);
    if (minVolume > 0) params.set("min_volume", String(minVolume));
    if (maxAge) params.set("max_age", maxAge);

    return fetch(`/api/pools?${params}`).then((r) => r.json()) as Promise<PoolsResponse>;
  }, [sort, search, page, minVolume, maxAge]);

  const { data, loading } = usePolling(fetcher, POLLING_INTERVALS.TABLE);

  const pools = data?.pools ?? [];
  const totalPages = data?.totalPages ?? 1;

  const sortLabel: Record<SortField, string> = {
    volume_24h: "Top Pools by Volume",
    liquidity_usd: "Top Pools by Liquidity",
    price_change_24h: "Top Gainers",
    trending: "Trending Now",
  };

  return (
    <div className="flex-1 min-w-0">
      {/* Search + Filters */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <SearchBar value={search} onChange={(v) => { setSearch(v); setPage(1); }} />
        {bp !== "mobile" && (
          <FilterChips
            minVolume={minVolume}
            maxAge={maxAge}
            onMinVolumeChange={(v) => { setMinVolume(v); setPage(1); }}
            onMaxAgeChange={(v) => { setMaxAge(v); setPage(1); }}
          />
        )}
        <div className="ml-auto">
          <SortDropdown value={sort} onChange={(v) => { setSort(v); setPage(1); }} />
        </div>
      </div>

      {/* Table header */}
      <div className="px-4 pb-2 flex items-center gap-2">
        <span style={{ color: "var(--accent-teal)" }}>✧</span>
        <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          {sortLabel[sort]}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b" style={{ borderColor: "var(--border)" }}>
              <th className="px-4 py-2 text-left font-medium w-8" style={{ color: "var(--text-muted)" }}>#</th>
              <th className="px-2 py-2 text-left font-medium" style={{ color: "var(--text-muted)" }}>Token</th>
              <th className="px-2 py-2 text-right font-medium" style={{ color: "var(--text-muted)" }}>Price</th>
              {bp !== "mobile" && bp !== "tablet" && (
                <>
                  <th className="px-2 py-2 text-right font-medium" style={{ color: "var(--text-muted)" }}>5m</th>
                  <th className="px-2 py-2 text-right font-medium" style={{ color: "var(--text-muted)" }}>1h</th>
                  <th className="px-2 py-2 text-right font-medium" style={{ color: "var(--text-muted)" }}>6h</th>
                </>
              )}
              <th className="px-2 py-2 text-right font-medium" style={{ color: "var(--text-muted)" }}>
                {bp === "mobile" ? "5m" : "24h"}
              </th>
              {bp !== "mobile" && (
                <>
                  <th className="px-2 py-2 text-right font-medium" style={{ color: "var(--text-muted)" }}>Volume 24h</th>
                  <th className="px-2 py-2 text-right font-medium" style={{ color: "var(--text-muted)" }}>Liquidity</th>
                </>
              )}
              {bp === "desktop" && (
                <>
                  <th className="px-2 py-2 text-right font-medium" style={{ color: "var(--text-muted)" }}>MCap</th>
                  <th className="px-2 py-2 text-right font-medium" style={{ color: "var(--text-muted)" }}>Makers</th>
                  <th className="px-2 py-2 text-right font-medium" style={{ color: "var(--text-muted)" }}>TXNS</th>
                  <th className="px-2 py-2 text-right font-medium" style={{ color: "var(--text-muted)" }}>Age</th>
                  <th className="px-2 py-2 text-right font-medium" style={{ color: "var(--text-muted)" }}>Pool</th>
                </>
              )}
              {bp === "tablet" && (
                <th className="px-2 py-2 text-right font-medium" style={{ color: "var(--text-muted)" }}>TXNS</th>
              )}
            </tr>
          </thead>
          <tbody>
            {loading && pools.length === 0
              ? Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i} className="border-b" style={{ borderColor: "var(--border)" }}>
                    <td colSpan={15} className="px-4 py-4">
                      <div className="h-4 rounded animate-pulse" style={{ background: "var(--bg-hover)", width: `${60 + Math.random() * 30}%` }} />
                    </td>
                  </tr>
                ))
              : pools.map((pool, i) => (
                  <PoolRow
                    key={pool.id}
                    pool={pool}
                    rank={(page - 1) * 20 + i + 1}
                    breakpoint={bp}
                  />
                ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 text-sm" style={{ color: "var(--text-muted)" }}>
          <span>
            Showing {(page - 1) * 20 + 1}-{Math.min(page * 20, data?.total ?? 0)} of {data?.total ?? 0} pools
          </span>
          <div className="flex gap-1">
            {Array.from({ length: Math.min(totalPages, 7) }).map((_, i) => (
              <button
                key={i}
                onClick={() => setPage(i + 1)}
                className="px-2.5 py-1 rounded text-xs"
                style={{
                  background: page === i + 1 ? "var(--accent-teal)" : "var(--bg-hover)",
                  color: page === i + 1 ? "#000" : "var(--text-secondary)",
                }}
              >
                {i + 1}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
