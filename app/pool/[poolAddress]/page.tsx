"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Navbar } from "@/components/layout/Navbar";
import { PoolHeaderTop, type PoolHeaderData } from "@/components/pool-detail/PoolHeader";
import { CandlestickChart } from "@/components/pool-detail/CandlestickChart";
import { SimilarPatterns } from "@/components/pool-detail/SimilarPatterns";
import { LiquidityPools } from "@/components/pool-detail/LiquidityPools";
import { TransactionsTable } from "@/components/pool-detail/TransactionsTable";
import { TopTraders } from "@/components/pool-detail/TopTraders";
import { RecentEvents } from "@/components/pool-detail/RecentEvents";
import { formatPrice, formatPercent, formatUsd } from "@/lib/format";
import { TokenSidebar } from "@/components/pool-detail/TokenSidebar";

function TokenIcon({ url, symbol, size = 24 }: { url?: string; symbol: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    return (
      <div
        className="rounded-full shrink-0 flex items-center justify-center font-bold"
        style={{ width: size, height: size, background: "var(--bg-hover)", color: "var(--text-secondary)", fontSize: size * 0.45 }}
      >
        {symbol.charAt(0)}
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={symbol}
      className="rounded-full shrink-0"
      style={{ width: size, height: size, background: "var(--bg-hover)" }}
      onError={() => setFailed(true)}
    />
  );
}

export default function PoolDetailPage() {
  const params = useParams();
  const router = useRouter();
  const poolAddress = params.poolAddress as string;

  const [poolData, setPoolData] = useState<PoolHeaderData | null>(null);
  const [timeRange, setTimeRange] = useState("15m");
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"transactions" | "similar" | "liquidity" | "top-traders">("transactions");
  const [mobileSection, setMobileSection] = useState<"info" | "chart" | "transactions" | "similar" | "liquidity" | "top-traders">("info");

  const fetchPoolData = useCallback(async () => {
    try {
      const res = await fetch(`/api/pool/${poolAddress}`);
      if (!res.ok) throw new Error("Failed to fetch pool");
      const data = await res.json();
      setPoolData(data);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [poolAddress]);

  useEffect(() => {
    fetchPoolData();
    const iv = setInterval(fetchPoolData, 5000);
    return () => clearInterval(iv);
  }, [fetchPoolData]);

  const navigateToPool = useCallback((address: string) => {
    router.push(`/pool/${address}`);
  }, [router]);

  const handleNavbarNavigate = useCallback((page: string) => {
    if (page === "screener") {
      router.push("/");
    } else if (page === "sql-console") {
      router.push("/?page=sql-console");
    }
  }, [router]);

  if (loading && !poolData) {
    return (
      <main className="min-h-screen flex flex-col" style={{ background: "var(--bg-primary)" }}>
        <Navbar onNavigate={handleNavbarNavigate} />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-sm" style={{ color: "var(--text-muted)" }}>Loading pool data...</div>
        </div>
      </main>
    );
  }

  if (!poolData) {
    return (
      <main className="min-h-screen flex flex-col" style={{ background: "var(--bg-primary)" }}>
        <Navbar onNavigate={handleNavbarNavigate} />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-sm mb-2" style={{ color: "var(--text-muted)" }}>Pool not found</div>
            <button
              onClick={() => router.push("/")}
              className="text-xs"
              style={{ color: "var(--accent-teal)" }}
            >
              ← Go back to DEX screener
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col" style={{ background: "var(--bg-primary)" }}>
      <Navbar onNavigate={handleNavbarNavigate} />
      {/* ── DEXScreener-style full-stretch layout ── */}
      <div className="flex-1 flex flex-col lg:flex-row">

        {/* ── Left: Chart + Content (scrollable) ── */}
        <div className="flex-1 min-w-0 overflow-y-auto pb-14 lg:pb-0">

          {/* Token tab bar — desktop only */}
          <div
            className="hidden lg:flex items-center gap-3 px-4 py-2.5 border-b"
            style={{ background: "var(--bg-sidebar)", borderColor: "var(--border)" }}
          >
            <button
              onClick={() => router.push("/")}
              className="shrink-0 flex items-center justify-center w-7 h-7 rounded-md transition-colors"
              style={{ color: "var(--text-muted)" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text-primary)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-muted)"; }}
              title="Back to DEX Screener"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>arrow_back</span>
            </button>
            <div className="flex items-center gap-2 min-w-0 overflow-hidden">
              <TokenIcon url={poolData.base_token.icon_url} symbol={poolData.base_token.symbol} size={24} />
              <span className="text-sm font-semibold whitespace-nowrap" style={{ color: "var(--text-primary)" }}>
                {poolData.base_token.symbol}/{poolData.quote_token.symbol}
              </span>
              <span className="text-xs whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
                {poolData.dex}
              </span>
              <span className="w-px h-4 shrink-0" style={{ background: "var(--border)" }} />
              <span className="text-sm font-mono font-semibold whitespace-nowrap" style={{ color: "var(--text-primary)" }}>
                {formatPrice(poolData.current_price)}
              </span>
              {(() => {
                const change = poolData.price_changes["1h"] ?? 0;
                const isPos = change >= 0;
                return (
                  <span className="text-xs font-semibold whitespace-nowrap" style={{ color: isPos ? "var(--accent-green)" : "var(--accent-red)" }}>
                    {isPos ? "+" : ""}{formatPercent(change)}
                  </span>
                );
              })()}
              <span className="w-px h-4 shrink-0" style={{ background: "var(--border)" }} />
              <span className="text-xs whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
                MCap <span style={{ color: "var(--text-secondary)" }}>{formatUsd(poolData.market_cap)}</span>
              </span>
              <span className="text-xs whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
                Vol <span style={{ color: "var(--text-secondary)" }}>{formatUsd(poolData.volume_24h)}</span>
              </span>
              <span className="text-xs whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
                Liq <span style={{ color: "var(--text-secondary)" }}>{formatUsd(poolData.liquidity)}</span>
              </span>
              <span className="w-1.5 h-1.5 rounded-full shrink-0 ml-auto" style={{ background: "var(--accent-green)" }} />
            </div>
          </div>

          {/* ── Mobile: section content based on bottom nav ── */}
          <div className="lg:hidden">
            {mobileSection === "info" && (
              <div className="p-4 space-y-4">
                <button
                  onClick={() => router.push("/")}
                  className="flex items-center gap-1.5 text-sm transition-colors"
                  style={{ color: "var(--text-muted)" }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>arrow_back</span>
                  Back
                </button>
                <TokenSidebar data={poolData} />
                <div className="h-px" style={{ background: "var(--border)" }} />
                <RecentEvents poolAddress={poolAddress} />
              </div>
            )}
            {mobileSection === "chart" && (
              <div className="flex flex-col p-4 gap-4" style={{ background: "var(--bg-sidebar)", minHeight: "calc(100vh - 54px - 56px)" }}>
                <CandlestickChart poolAddress={poolAddress} timeRange={timeRange} onTimeRangeChange={setTimeRange} mobileFullHeight />
              </div>
            )}
            {mobileSection === "transactions" && (
              <div className="p-4">
                <TransactionsTable poolAddress={poolAddress} />
              </div>
            )}
            {mobileSection === "similar" && (
              <div className="p-4">
                <SimilarPatterns poolAddress={poolAddress} onNavigate={navigateToPool} />
              </div>
            )}
            {mobileSection === "liquidity" && (
              <div className="p-4">
                <LiquidityPools tokenAddress={poolData.base_token.address} currentPoolAddress={poolAddress} onNavigate={navigateToPool} />
              </div>
            )}
            {mobileSection === "top-traders" && (
              <div className="p-4">
                <TopTraders poolAddress={poolAddress} tokenSymbol={poolData.base_token.symbol} />
              </div>
            )}
          </div>

          {/* ── Desktop: Chart + Tabs ── */}
          <div className="hidden lg:block">
            {/* Chart card */}
            <div
              className="border-b p-4 space-y-4"
              style={{ background: "var(--bg-sidebar)", borderColor: "var(--border)" }}
            >
              <CandlestickChart poolAddress={poolAddress} timeRange={timeRange} onTimeRangeChange={setTimeRange} />
            </div>

            {/* Tabbed content below chart */}
            <div>
              <div
                className="flex border-b overflow-x-auto"
                style={{ borderColor: "var(--border)" }}
              >
                {([
                  { key: "transactions", label: "Transactions" },
                  { key: "similar", label: "Similar Patterns" },
                  { key: "liquidity", label: "Liquidity Pools" },
                  { key: "top-traders", label: "Top Traders" },
                ] as const).map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className="px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors shrink-0"
                    style={{
                      color: activeTab === tab.key ? "var(--text-primary)" : "var(--text-muted)",
                      borderBottom: activeTab === tab.key ? "2px solid var(--accent-teal)" : "2px solid transparent",
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className="p-4">
                {activeTab === "transactions" && (
                  <TransactionsTable poolAddress={poolAddress} />
                )}
                {activeTab === "similar" && (
                  <SimilarPatterns poolAddress={poolAddress} onNavigate={navigateToPool} />
                )}
                {activeTab === "liquidity" && (
                  <LiquidityPools
                    tokenAddress={poolData.base_token.address}
                    currentPoolAddress={poolAddress}
                    onNavigate={navigateToPool}
                  />
                )}
                {activeTab === "top-traders" && (
                  <TopTraders poolAddress={poolAddress} tokenSymbol={poolData.base_token.symbol} />
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Right Sidebar (desktop: sticky full-height column) ── */}
        <aside
          className="hidden lg:block shrink-0 border-l overflow-y-auto"
          style={{
            width: 380,
            height: "calc(100vh - 54px)",
            position: "sticky",
            top: 54,
            background: "var(--bg-sidebar)",
            borderColor: "var(--border)",
          }}
        >
          <div className="p-4 space-y-4">
            <TokenSidebar data={poolData} sidebarMode />
            <div className="h-px" style={{ background: "var(--border)" }} />
            <RecentEvents poolAddress={poolAddress} />
          </div>
        </aside>

        {/* ── Mobile Bottom Nav ── */}
        <nav
          className="lg:hidden fixed bottom-0 inset-x-0 z-50 flex items-center justify-around border-t"
          style={{ background: "var(--bg-secondary)", borderColor: "var(--border)", height: 56 }}
        >
          {([
            { key: "info", icon: "info", label: "Info" },
            { key: "chart", icon: "candlestick_chart", label: "Chart" },
            { key: "transactions", icon: "receipt_long", label: "Txns" },
            { key: "similar", icon: "pattern", label: "Patterns" },
            { key: "liquidity", icon: "water_drop", label: "Pools" },
            { key: "top-traders", icon: "leaderboard", label: "Traders" },
          ] as const).map((item) => {
            const active = mobileSection === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setMobileSection(item.key)}
                className="flex flex-col items-center gap-0.5 py-1 px-2"
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 20, color: active ? "var(--accent-teal)" : "var(--text-muted)" }}
                >
                  {item.icon}
                </span>
                <span style={{ color: active ? "var(--accent-teal)" : "var(--text-muted)", fontSize: 12 }}>
                  {item.label}
                </span>
              </button>
            );
          })}
        </nav>
      </div>
    </main>
  );
}
