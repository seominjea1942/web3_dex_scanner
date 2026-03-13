"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { usePolling } from "@/hooks/usePolling";
import { useBreakpoint } from "@/hooks/useBreakpoint";
import { POLLING_INTERVALS } from "@/lib/constants";
import { PoolRow } from "./PoolRow";
import { SearchBar } from "./SearchBar";
import { FilterChips } from "./FilterChips";
import { SortDropdown } from "./SortDropdown";
import type { Pool, SortField, FilterType } from "@/lib/types";

const CLIENT_TICK_MS = 2_000;

function applyClientJitter(pools: Pool[]): Pool[] {
  return pools.map((p) => {
    const price = Number(p.price_usd);
    const pj = price * (Math.random() - 0.5) * 0.001; // ±0.05%
    const vol = Number(p.volume_24h);
    const vj = vol * (Math.random() - 0.5) * 0.004; // ±0.2%
    const liq = Number(p.liquidity_usd);
    const lj = liq * (Math.random() - 0.5) * 0.002; // ±0.1%
    const mcap = Number(p.market_cap);
    const mj = mcap * (Math.random() - 0.5) * 0.001;
    const makers = Number(p.makers);
    const mkj = Math.round((Math.random() - 0.5) * Math.max(2, makers * 0.001));
    return {
      ...p,
      price_usd: +(price + pj).toFixed(price < 1 ? 6 : 2),
      price_change_5m: +(Number(p.price_change_5m) + (Math.random() - 0.5) * 0.04).toFixed(2),
      price_change_1h: +(Number(p.price_change_1h) + (Math.random() - 0.5) * 0.02).toFixed(2),
      volume_24h: +(vol + vj).toFixed(2),
      liquidity_usd: +(liq + lj).toFixed(2),
      market_cap: +(mcap + mj).toFixed(2),
      makers: makers + mkj,
      txns_24h: Number(p.txns_24h) + mkj,
    };
  });
}

function PaginationBtn({ label, onClick, disabled }: { label: string; onClick: () => void; disabled: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-7 h-7 rounded-md flex items-center justify-center transition-colors"
      style={{
        color: disabled ? "var(--text-muted)" : "var(--text-secondary)",
        opacity: disabled ? 0.35 : 1,
        fontSize: 16,
        lineHeight: 1,
      }}
    >
      {label}
    </button>
  );
}

function PageSizeDropdown({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const options = [20, 50, 100];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="h-7 px-3 rounded-lg text-xs border flex items-center gap-1.5 cursor-pointer transition-colors"
        style={{
          background: "var(--bg-card)",
          borderColor: "var(--border)",
          color: "var(--text-secondary)",
        }}
      >
        {value} / page
        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>expand_more</span>
      </button>
      {open && (
        <div
          className="absolute bottom-full mb-1 right-0 w-28 rounded-lg border py-1 z-40"
          style={{ background: "var(--bg-card)", borderColor: "var(--border)", boxShadow: "0 8px 24px rgba(0,0,0,0.3)" }}
        >
          {options.map((opt) => (
            <button
              key={opt}
              onClick={() => { onChange(opt); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-xs transition-colors"
              style={{
                color: value === opt ? "var(--accent-teal)" : "var(--text-secondary)",
                background: value === opt ? "rgba(45, 212, 191, 0.05)" : "transparent",
              }}
            >
              {opt} / page
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function buildPageNumbers(current: number, total: number, compact = false): (number | "...")[] {
  // Compact mode for mobile: show max 5 slots
  if (compact) {
    if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1);
    const pages: (number | "...")[] = [];
    pages.push(1);
    if (current <= 3) {
      for (let i = 2; i <= 3; i++) pages.push(i);
      pages.push("...");
      pages.push(total);
    } else if (current >= total - 2) {
      pages.push("...");
      for (let i = total - 2; i <= total; i++) pages.push(i);
    } else {
      pages.push("...");
      pages.push(current);
      pages.push("...");
      pages.push(total);
    }
    return pages;
  }

  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages: (number | "...")[] = [];

  // Always show first page
  pages.push(1);

  if (current <= 4) {
    // Near start: 1 2 3 4 5 6 ... last
    for (let i = 2; i <= 6; i++) pages.push(i);
    pages.push("...");
    pages.push(total);
  } else if (current >= total - 3) {
    // Near end: 1 ... last-5 last-4 last-3 last-2 last-1 last
    pages.push("...");
    for (let i = total - 5; i <= total; i++) pages.push(i);
  } else {
    // Middle: 1 ... cur-1 cur cur+1 ... last
    pages.push("...");
    pages.push(current - 1);
    pages.push(current);
    pages.push(current + 1);
    pages.push("...");
    pages.push(total);
  }

  return pages;
}

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
  const [pageSize, setPageSize] = useState(20);
  const [activeFilter, setActiveFilter] = useState<FilterType>(null);

  const fetcher = useCallback(() => {
    const params = new URLSearchParams({
      sort,
      order: "desc",
      page: String(page),
      limit: String(pageSize),
    });
    if (search) params.set("search", search);
    if (activeFilter) params.set("filter", activeFilter);

    return fetch(`/api/pools?${params}`).then((r) => r.json()) as Promise<PoolsResponse>;
  }, [sort, search, page, pageSize, activeFilter]);

  const resetKey = `${sort}-${activeFilter}-${search}-${page}-${pageSize}`;
  const { data, loading } = usePolling(fetcher, POLLING_INTERVALS.TABLE, true, resetKey);

  // Store the last API response as the "base" and apply client-side jitter every 5s
  const basePoolsRef = useRef<Pool[]>([]);
  const [displayPools, setDisplayPools] = useState<Pool[]>([]);

  // When new API data arrives, update base and display immediately
  useEffect(() => {
    const newPools = data?.pools ?? [];
    if (newPools.length > 0) {
      basePoolsRef.current = newPools;
      setDisplayPools(newPools);
    }
  }, [data]);

  // Client-side tick: jitter every 5s between API polls
  useEffect(() => {
    const id = setInterval(() => {
      if (basePoolsRef.current.length > 0) {
        setDisplayPools(applyClientJitter(basePoolsRef.current));
      }
    }, CLIENT_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const pools = displayPools;

  // Keep stable totalPages/total so pagination doesn't flicker during page transitions
  const stablePaginationRef = useRef({ totalPages: 1, total: 0 });
  if (data?.totalPages) {
    stablePaginationRef.current = { totalPages: data.totalPages, total: data.total };
  }
  const totalPages = stablePaginationRef.current.totalPages;
  const stableTotal = stablePaginationRef.current.total;

  const sortLabel: Record<SortField, string> = {
    volume_24h: "Top Pools by Volume",
    liquidity_usd: "Top Pools by Liquidity",
    price_change_24h: "Top Gainers",
    trending: "Trending Now",
    newest: "Newest Pools",
  };

  const filterLabel: Record<string, { text: string; icon: string; color: string }> = {
    hot: { text: "Hot Right Now", icon: "local_fire_department", color: "var(--accent-orange)" },
    gainers: { text: "Top Gainers", icon: "trending_up", color: "var(--accent-green)" },
    losers: { text: "Top Losers", icon: "trending_down", color: "var(--accent-red)" },
  };

  const headerInfo = activeFilter && filterLabel[activeFilter]
    ? filterLabel[activeFilter]
    : { text: sortLabel[sort], icon: "crown", color: "var(--accent-teal)" };

  return (
    <div className="flex-1 min-w-0">
      {/* Search + Filters */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <SearchBar value={search} onChange={(v) => { setSearch(v); setPage(1); }} />
        <FilterChips
          activeFilter={activeFilter}
          onFilterChange={(f) => { setActiveFilter(f); setPage(1); }}
        />
        <div className={bp !== "mobile" ? "ml-auto" : ""}>
          <SortDropdown value={sort} onChange={(v) => { setSort(v); setPage(1); }} />
        </div>
      </div>

      <div className="border-b" style={{ borderColor: "var(--border)" }} />

      {/* Table header */}
      <div className="px-4 pt-3 pb-2 flex items-center gap-2">
        <span className="material-symbols-outlined" style={{ fontSize: 16, color: headerInfo.color }}>{headerInfo.icon}</span>
        <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          {headerInfo.text}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-max">
          <thead>
            <tr className="border-b" style={{ borderColor: "var(--border)" }}>
              <th className="px-4 py-2 text-left font-medium w-8 sticky left-0 z-10" style={{ color: "var(--text-muted)", background: "var(--bg-primary)" }}>#</th>
              <th className="px-3 py-2 text-left font-medium sticky left-10 z-10" style={{ color: "var(--text-muted)", background: "var(--bg-primary)" }}>Token</th>
              <th className="px-3 py-2 text-right font-medium" style={{ color: "var(--text-muted)" }}>Price</th>
              {bp !== "mobile" && bp !== "tablet" && (
                <>
                  <th className="px-3 py-2 text-right font-medium" style={{ color: "var(--text-muted)" }}>5m</th>
                  <th className="px-3 py-2 text-right font-medium" style={{ color: "var(--text-muted)" }}>1h</th>
                  <th className="px-3 py-2 text-right font-medium" style={{ color: "var(--text-muted)" }}>6h</th>
                </>
              )}
              <th className="px-3 py-2 text-right font-medium" style={{ color: "var(--text-muted)" }}>24h</th>
              <th className="px-3 py-2 text-right font-medium whitespace-nowrap" style={{ color: "var(--text-muted)" }}>Volume 24h</th>
              <th className="px-3 py-2 text-right font-medium" style={{ color: "var(--text-muted)" }}>Liquidity</th>
              {bp === "desktop" && (
                <>
                  <th className="px-3 py-2 text-right font-medium" style={{ color: "var(--text-muted)" }}>MCap</th>
                  <th className="px-3 py-2 text-right font-medium" style={{ color: "var(--text-muted)" }}>Makers</th>
                  <th className="px-3 py-2 text-right font-medium" style={{ color: "var(--text-muted)" }}>TXNS</th>
                  <th className="px-3 py-2 text-right font-medium" style={{ color: "var(--text-muted)" }}>Age</th>
                  <th className="px-3 py-2 text-right font-medium" style={{ color: "var(--text-muted)" }}>Pool</th>
                </>
              )}
              {bp === "tablet" && (
                <th className="px-3 py-2 text-right font-medium" style={{ color: "var(--text-muted)" }}>TXNS</th>
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
                    rank={(page - 1) * pageSize + i + 1}
                    breakpoint={bp}
                  />
                ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div
          className={`flex items-center px-4 py-3 text-sm ${bp === "mobile" ? "flex-col gap-2" : "justify-between"}`}
          style={{ color: "var(--text-muted)" }}
        >
          {/* Left: Showing X of Y */}
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, stableTotal)} of{" "}
            <span style={{ color: "var(--text-secondary)" }}>{stableTotal}</span> pools
          </span>

          {/* Right: Page controls + per-page */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-0.5">
              {/* First — hide on mobile */}
              {bp !== "mobile" && (
                <PaginationBtn
                  label="«"
                  onClick={() => setPage(1)}
                  disabled={page <= 1}
                />
              )}
              {/* Prev */}
              <PaginationBtn
                label="‹"
                onClick={() => setPage(page - 1)}
                disabled={page <= 1}
              />

              {/* Page numbers with ellipsis */}
              {buildPageNumbers(page, totalPages, bp === "mobile").map((item, i) =>
                item === "..." ? (
                  <span key={`ellipsis-${i}`} className="w-7 h-7 flex items-center justify-center text-xs" style={{ color: "var(--text-muted)" }}>
                    ···
                  </span>
                ) : (
                  <button
                    key={item}
                    onClick={() => setPage(item as number)}
                    className="w-7 h-7 rounded-md text-xs font-medium transition-colors"
                    style={{
                      background: page === item ? "var(--bg-hover)" : "transparent",
                      color: page === item ? "var(--text-primary)" : "var(--text-muted)",
                      border: page === item ? "1px solid var(--border)" : "1px solid transparent",
                    }}
                  >
                    {item}
                  </button>
                )
              )}

              {/* Next */}
              <PaginationBtn
                label="›"
                onClick={() => setPage(page + 1)}
                disabled={page >= totalPages}
              />
              {/* Last — hide on mobile */}
              {bp !== "mobile" && (
                <PaginationBtn
                  label="»"
                  onClick={() => setPage(totalPages)}
                  disabled={page >= totalPages}
                />
              )}
            </div>

            {/* Per-page selector */}
            <PageSizeDropdown
              value={pageSize}
              onChange={(v) => { setPageSize(v); setPage(1); }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
