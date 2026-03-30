"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { formatPrice, formatCompact, truncateAddress } from "@/lib/format";

interface Transaction {
  id: string;
  signature: string;
  timestamp: string;
  type: "buy" | "sell";
  price_usd: number;
  amount: number;
  total_usd: number;
  maker_address: string;
  wallet_label: string | null;
  dex: string;
}

interface TransactionsTableProps {
  poolAddress: string;
}

const DIRECTION_TABS = ["All", "Buy", "Sell"] as const;
const WALLET_TYPES = ["whale", "smart_money", "bot"] as const;
const AMOUNT_FILTERS = [100, 1000, 10000, 100000] as const;
const TIME_RANGES = ["5m", "15m", "1h", "6h", "24h"] as const;

const WALLET_ICONS: Record<string, string> = {
  whale: "waves",
  smart_money: "diamond",
  bot: "smart_toy",
  active_trader: "trending_up",
};

function relativeTimeShort(ts: string): string {
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function TransactionsTable({ poolAddress }: TransactionsTableProps) {
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [queryTime, setQueryTime] = useState(0);
  const [loading, setLoading] = useState(true);

  // Filters
  const [direction, setDirection] = useState<string>("all");
  const [walletTypes, setWalletTypes] = useState<Set<string>>(new Set());
  const [minAmount, setMinAmount] = useState<number | null>(null);
  const [timeRange, setTimeRange] = useState<string>("");
  const [page, setPage] = useState(1);
  const prevIdsRef = useRef<Set<string>>(new Set());
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (direction !== "all") count++;
    count += walletTypes.size;
    if (minAmount != null) count++;
    if (timeRange) count++;
    return count;
  }, [direction, walletTypes, minAmount, timeRange]);

  // Close popover on outside click
  useEffect(() => {
    if (!showMobileFilters) return;
    const handler = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setShowMobileFilters(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showMobileFilters]);

  const fetchTxns = useCallback(async () => {
    const params = new URLSearchParams();
    params.set("direction", direction);
    params.set("time_range", timeRange);
    params.set("page", String(page));
    params.set("limit", "50");
    if (walletTypes.size > 0) params.set("wallet_type", Array.from(walletTypes).join(","));
    if (minAmount != null) params.set("min_amount", String(minAmount));

    const res = await fetch(`/api/pool/${poolAddress}/transactions?${params}`);
    if (!res.ok) return;
    const data = await res.json();

    const newTxns: Transaction[] = data.transactions || [];
    // Detect new rows for flash animation
    const newIds = new Set(newTxns.map((t) => t.id));
    const fresh = new Set<string>();
    Array.from(newIds).forEach((id) => {
      if (!prevIdsRef.current.has(id)) fresh.add(id);
    });
    prevIdsRef.current = newIds;
    if (fresh.size > 0 && fresh.size < newTxns.length) {
      setFlashIds(fresh);
      setTimeout(() => setFlashIds(new Set()), 1500);
    }

    setTxns(newTxns);
    setTotal(data.total || 0);
    setQueryTime(data.query_time_ms || 0);
    setLoading(false);
  }, [poolAddress, direction, walletTypes, minAmount, timeRange, page]);

  useEffect(() => {
    setLoading(true);
    fetchTxns();
    const iv = setInterval(fetchTxns, 5000);
    return () => clearInterval(iv);
  }, [fetchTxns]);

  const toggleWalletType = (wt: string) => {
    setWalletTypes((prev) => {
      const next = new Set(prev);
      if (next.has(wt)) next.delete(wt);
      else next.add(wt);
      return next;
    });
    setPage(1);
  };

  return (
    <div
      className="rounded-lg border overflow-hidden flex flex-col h-full"
      style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined" style={{ fontSize: 16, color: "var(--accent-teal)" }}>receipt_long</span>
          <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Transactions</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Mobile filter button */}
          <div className="relative md:hidden" ref={filterRef}>
            <button
              onClick={() => setShowMobileFilters((v) => !v)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors"
              style={{
                background: showMobileFilters || activeFilterCount > 0 ? "var(--bg-hover)" : "transparent",
                borderColor: activeFilterCount > 0 ? "var(--accent-teal)" : "var(--border)",
                color: activeFilterCount > 0 ? "var(--accent-teal)" : "var(--text-muted)",
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>tune</span>
              Filter
              {activeFilterCount > 0 && (
                <span
                  className="flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold"
                  style={{ background: "var(--accent-teal)", color: "#000" }}
                >
                  {activeFilterCount}
                </span>
              )}
            </button>

            {/* Mobile filter popover */}
            {showMobileFilters && (
              <div
                className="absolute right-0 top-full mt-2 z-50 rounded-lg border p-3 flex flex-col gap-3"
                style={{
                  background: "var(--bg-card)",
                  borderColor: "var(--border)",
                  boxShadow: "0 12px 32px rgba(0,0,0,0.4)",
                  width: "calc(100vw - 2rem)",
                  maxWidth: 320,
                }}
              >
                {/* Direction */}
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--text-muted)" }}>Direction</div>
                  <div className="flex items-center gap-1">
                    {DIRECTION_TABS.map((tab) => {
                      const active = direction === tab.toLowerCase();
                      return (
                        <button
                          key={tab}
                          onClick={() => { setDirection(tab.toLowerCase()); setPage(1); }}
                          className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
                          style={{
                            background: active ? "var(--bg-hover)" : "transparent",
                            color: active ? "var(--text-primary)" : "var(--text-muted)",
                            border: `1px solid ${active ? "var(--accent-teal)" : "var(--border)"}`,
                          }}
                        >
                          {tab}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Wallet type */}
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--text-muted)" }}>Wallet Type</div>
                  <div className="flex flex-wrap gap-1.5">
                    {WALLET_TYPES.map((wt) => {
                      const active = walletTypes.has(wt);
                      return (
                        <button
                          key={wt}
                          onClick={() => toggleWalletType(wt)}
                          className="flex items-center gap-1 px-2 py-1.5 rounded-full text-xs border transition-colors"
                          style={{
                            background: active ? "var(--bg-hover)" : "transparent",
                            borderColor: active ? "var(--accent-teal)" : "var(--border)",
                            color: active ? "var(--text-primary)" : "var(--text-muted)",
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 12 }}>{WALLET_ICONS[wt]}</span>
                          {wt.replace("_", " ")}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Min amount */}
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--text-muted)" }}>Min Amount</div>
                  <div className="flex flex-wrap gap-1.5">
                    {AMOUNT_FILTERS.map((amt) => {
                      const active = minAmount === amt;
                      return (
                        <button
                          key={amt}
                          onClick={() => { setMinAmount(active ? null : amt); setPage(1); }}
                          className="px-2.5 py-1.5 rounded-full text-xs border transition-colors"
                          style={{
                            background: active ? "var(--bg-hover)" : "transparent",
                            borderColor: active ? "var(--accent-teal)" : "var(--border)",
                            color: active ? "var(--text-primary)" : "var(--text-muted)",
                          }}
                        >
                          ${amt >= 1000 ? `${amt / 1000}K` : amt}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Time range */}
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--text-muted)" }}>Time Range</div>
                  <div className="flex flex-wrap gap-1.5">
                    {TIME_RANGES.map((tr) => {
                      const active = timeRange === tr;
                      return (
                        <button
                          key={tr}
                          onClick={() => { setTimeRange(active ? "" : tr); setPage(1); }}
                          className="px-2.5 py-1.5 rounded-full text-xs border transition-colors"
                          style={{
                            background: active ? "var(--bg-hover)" : "transparent",
                            borderColor: active ? "var(--accent-teal)" : "var(--border)",
                            color: active ? "var(--text-primary)" : "var(--text-muted)",
                          }}
                        >
                          {tr}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Direction tabs — desktop only */}
          <div className="hidden md:flex items-center rounded-md overflow-hidden border" style={{ borderColor: "var(--border)" }}>
            {DIRECTION_TABS.map((tab) => {
              const active = direction === tab.toLowerCase();
              return (
                <button
                  key={tab}
                  onClick={() => { setDirection(tab.toLowerCase()); setPage(1); }}
                  className="px-3 py-1 text-xs font-medium transition-colors"
                  style={{
                    background: active ? "var(--bg-hover)" : "transparent",
                    color: active ? "var(--text-primary)" : "var(--text-muted)",
                  }}
                >
                  {tab}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Filter chips — desktop only */}
      <div className="hidden md:flex flex-wrap items-center gap-2 px-4 py-2 border-b" style={{ borderColor: "var(--border)" }}>
        {/* Wallet type filters */}
        {WALLET_TYPES.map((wt) => {
          const active = walletTypes.has(wt);
          return (
            <button
              key={wt}
              onClick={() => toggleWalletType(wt)}
              className="flex items-center gap-1 px-2 py-1 rounded-full text-xs border transition-colors"
              style={{
                background: active ? "var(--bg-hover)" : "transparent",
                borderColor: active ? "var(--accent-teal)" : "var(--border)",
                color: active ? "var(--text-primary)" : "var(--text-muted)",
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 12 }}>{WALLET_ICONS[wt]}</span>
              {wt.replace("_", " ")}
            </button>
          );
        })}

        <div className="w-px h-4" style={{ background: "var(--border)" }} />

        {/* Amount filters */}
        {AMOUNT_FILTERS.map((amt) => {
          const active = minAmount === amt;
          return (
            <button
              key={amt}
              onClick={() => { setMinAmount(active ? null : amt); setPage(1); }}
              className="px-2 py-1 rounded-full text-xs border transition-colors"
              style={{
                background: active ? "var(--bg-hover)" : "transparent",
                borderColor: active ? "var(--accent-teal)" : "var(--border)",
                color: active ? "var(--text-primary)" : "var(--text-muted)",
              }}
            >
              ${amt >= 1000 ? `${amt / 1000}K` : amt}
            </button>
          );
        })}

        <div className="w-px h-4" style={{ background: "var(--border)" }} />

        {/* Time range */}
        {TIME_RANGES.map((tr) => {
          const active = timeRange === tr;
          return (
            <button
              key={tr}
              onClick={() => { setTimeRange(active ? "" : tr); setPage(1); }}
              className="px-2 py-1 rounded-full text-xs border transition-colors"
              style={{
                background: active ? "var(--bg-hover)" : "transparent",
                borderColor: active ? "var(--accent-teal)" : "var(--border)",
                color: active ? "var(--text-primary)" : "var(--text-muted)",
              }}
            >
              {tr}
            </button>
          );
        })}
      </div>

      {/* Result count */}
      <div className="px-4 py-1.5 text-xs border-b" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
        Showing <span className="font-semibold" style={{ color: "var(--text-primary)" }}>{txns.length.toLocaleString()}</span>
        {" "}of{" "}
        <span className="font-semibold" style={{ color: "var(--text-primary)" }}>{total.toLocaleString()}</span>
        {" "}transactions · <span style={{ color: "var(--accent-green)" }}>{queryTime}ms</span>
      </div>

      {/* Table */}
      <div className="overflow-auto flex-1 min-h-0">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ background: "var(--bg-secondary)" }}>
              {["DATE", "TYPE", "PRICE USD", "AMOUNT", "TOTAL", "MAKER", "TXN"].map((col) => (
                <th
                  key={col}
                  className="text-left px-3 py-2 font-semibold uppercase tracking-wide whitespace-nowrap sticky top-0 border-b"
                  style={{ color: "var(--text-muted)", borderColor: "var(--border)", background: "var(--bg-secondary)", fontSize: 12 }}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && txns.length === 0 ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? "var(--bg-primary)" : "var(--bg-card)" }}>
                  <td className="px-3 py-2"><div className="h-3 w-12 rounded shimmer-bg" /></td>
                  <td className="px-3 py-2"><div className="h-3 w-8 rounded shimmer-bg" /></td>
                  <td className="px-3 py-2"><div className="h-3 w-16 rounded shimmer-bg" /></td>
                  <td className="px-3 py-2"><div className="h-3 w-12 rounded shimmer-bg" /></td>
                  <td className="px-3 py-2"><div className="h-3 w-14 rounded shimmer-bg" /></td>
                  <td className="px-3 py-2"><div className="h-3 w-20 rounded shimmer-bg" /></td>
                  <td className="px-3 py-2"><div className="h-3 w-4 rounded shimmer-bg" /></td>
                </tr>
              ))
            ) : txns.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center" style={{ color: "var(--text-muted)" }}>
                  No transactions found
                </td>
              </tr>
            ) : txns.map((tx, i) => {
              const isBuy = tx.type === "buy";
              const isFlash = flashIds.has(tx.id);
              return (
                <tr
                  key={tx.id}
                  className="transition-colors"
                  style={{
                    background: isFlash
                      ? "rgba(129, 140, 248, 0.08)"
                      : i % 2 === 0 ? "var(--bg-primary)" : "var(--bg-card)",
                  }}
                >
                  <td className="px-3 py-2 whitespace-nowrap font-mono" style={{ color: "var(--text-muted)" }}>
                    {relativeTimeShort(tx.timestamp)}
                  </td>
                  <td className="px-3 py-2 font-semibold" style={{ color: isBuy ? "var(--accent-green)" : "var(--accent-red)" }}>
                    {tx.type.toUpperCase()}
                  </td>
                  <td className="px-3 py-2 font-mono" style={{ color: "var(--text-primary)" }}>
                    {formatPrice(tx.price_usd)}
                  </td>
                  <td className="px-3 py-2 font-mono" style={{ color: "var(--text-secondary)" }}>
                    {formatCompact(tx.amount)}
                  </td>
                  <td className="px-3 py-2 font-mono font-medium" style={{ color: tx.total_usd > 10000 ? "var(--text-primary)" : "var(--text-secondary)" }}>
                    ${formatCompact(tx.total_usd)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <span className="font-mono" style={{ color: "var(--text-secondary)" }} title={tx.maker_address}>
                        {truncateAddress(tx.maker_address)}
                      </span>
                      {tx.wallet_label && (
                        <span
                          className="text-xs px-1 py-px rounded font-semibold"
                          style={{
                            background: tx.wallet_label === "whale" ? "rgba(99, 102, 241, 0.15)" : "rgba(129, 140, 248, 0.15)",
                            color: tx.wallet_label === "whale" ? "var(--accent-blue)" : "var(--accent-teal)",
                          }}
                        >
                          {tx.wallet_label.replace("_", " ")}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <a
                      href={`https://solscan.io/tx/${tx.signature}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center"
                      style={{ color: "var(--text-muted)" }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>open_in_new</span>
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > 50 && (
        <div className="flex items-center justify-between px-4 py-2 border-t" style={{ borderColor: "var(--border)" }}>
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium transition-colors"
            style={{
              background: page <= 1 ? "transparent" : "var(--bg-hover)",
              color: page <= 1 ? "var(--text-muted)" : "var(--text-primary)",
              opacity: page <= 1 ? 0.5 : 1,
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>chevron_left</span>
            Prev
          </button>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            Page <span style={{ color: "var(--text-primary)" }}>{page}</span> of{" "}
            <span style={{ color: "var(--text-primary)" }}>{Math.ceil(total / 50)}</span>
          </span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={page >= Math.ceil(total / 50)}
            className="flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium transition-colors"
            style={{
              background: page >= Math.ceil(total / 50) ? "transparent" : "var(--bg-hover)",
              color: page >= Math.ceil(total / 50) ? "var(--text-muted)" : "var(--text-primary)",
              opacity: page >= Math.ceil(total / 50) ? 0.5 : 1,
            }}
          >
            Next
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>chevron_right</span>
          </button>
        </div>
      )}
    </div>
  );
}
