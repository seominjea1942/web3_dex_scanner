"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { PoolHeaderTop, PoolHeaderStats, type PoolHeaderData } from "@/components/pool-detail/PoolHeader";
import { CandlestickChart } from "@/components/pool-detail/CandlestickChart";
import { SimilarPatterns } from "@/components/pool-detail/SimilarPatterns";
import { LiquidityPools } from "@/components/pool-detail/LiquidityPools";
import { TransactionsTable } from "@/components/pool-detail/TransactionsTable";
import { TopTraders } from "@/components/pool-detail/TopTraders";
import { RecentEvents } from "@/components/pool-detail/RecentEvents";

export default function PoolDetailPage() {
  const params = useParams();
  const router = useRouter();
  const poolAddress = params.poolAddress as string;

  const [poolData, setPoolData] = useState<PoolHeaderData | null>(null);
  const [timeRange, setTimeRange] = useState("7D");
  const [loading, setLoading] = useState(true);

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

  if (loading && !poolData) {
    return (
      <main className="min-h-screen flex flex-col" style={{ background: "var(--bg-primary)" }}>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-sm" style={{ color: "var(--text-muted)" }}>Loading pool data...</div>
        </div>
      </main>
    );
  }

  if (!poolData) {
    return (
      <main className="min-h-screen flex flex-col" style={{ background: "var(--bg-primary)" }}>
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
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[1400px] mx-auto p-4 md:p-6 space-y-5">

          {/* Back link */}
          <button
            onClick={() => router.push("/")}
            className="flex items-center gap-1 text-xs transition-colors"
            style={{ color: "var(--text-muted)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent-teal)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>arrow_back</span>
            Go back to DEX screener
          </button>

          {/* Pool Header + Chart (merged card) */}
          <div
            className="rounded-lg border p-4 space-y-4"
            style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
          >
            <PoolHeaderTop data={poolData} timeRange={timeRange} />
            <CandlestickChart poolAddress={poolAddress} timeRange={timeRange} onTimeRangeChange={setTimeRange} />
            <PoolHeaderStats data={poolData} />
          </div>

          {/* Similar Patterns */}
          <SimilarPatterns poolAddress={poolAddress} onNavigate={navigateToPool} />

          {/* Liquidity Pools */}
          <LiquidityPools
            tokenAddress={poolData.base_token.address}
            currentPoolAddress={poolAddress}
            onNavigate={navigateToPool}
          />

          {/* Transactions */}
          <TransactionsTable poolAddress={poolAddress} />

          {/* Bottom row: Top Traders + Recent Events */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <TopTraders poolAddress={poolAddress} tokenSymbol={poolData.base_token.symbol} />
            <RecentEvents poolAddress={poolAddress} />
          </div>

        </div>
      </div>
    </main>
  );
}
