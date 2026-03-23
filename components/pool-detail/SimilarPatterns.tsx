"use client";

import { useEffect, useState } from "react";
import { formatUsd, formatPercent } from "@/lib/format";

interface SimilarPool {
  pool_address: string;
  pair_name: string;
  dex: string;
  similarity_score: number;
  volume_24h: number;
  price_change_24h: number;
  sparkline: number[];
}

interface SimilarPatternsProps {
  poolAddress: string;
  onNavigate: (address: string) => void;
}

function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 120;
  const h = 32;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="block">
      <polyline fill="none" stroke={color} strokeWidth={1.5} points={points} />
    </svg>
  );
}

export function SimilarPatterns({ poolAddress, onNavigate }: SimilarPatternsProps) {
  const [results, setResults] = useState<SimilarPool[]>([]);
  const [queryTime, setQueryTime] = useState<number | null>(null);

  useEffect(() => {
    fetch(`/api/pool/${poolAddress}/similar?limit=4`)
      .then((r) => r.json())
      .then((data) => {
        setResults(data.results || []);
        setQueryTime(data.query_time_ms ?? null);
      })
      .catch(() => {});
  }, [poolAddress]);

  if (results.length === 0) return null;

  return (
    <div
      className="rounded-lg border p-4"
      style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
    >
      {/* Header */}
      <div className="mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="material-symbols-outlined" style={{ fontSize: 18, color: "var(--accent-purple)" }}>auto_awesome</span>
          <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Similar Patterns</span>
          <span
            className="text-xs font-semibold px-2 py-0.5 rounded-full"
            style={{ border: "1px solid var(--accent-purple)", color: "var(--accent-purple)" }}
          >
            TiDB Vector Search
          </span>
          {queryTime != null && (
            <span className="text-xs ml-auto" style={{ color: "var(--accent-green)" }}>{queryTime}ms</span>
          )}
        </div>
        <div className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
          Pattern similarity computed via TiDB vector embeddings on 5m transaction sequences
        </div>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
        {results.map((pool) => {
          const isPositive = pool.price_change_24h >= 0;
          return (
            <button
              key={pool.pool_address}
              onClick={() => onNavigate(pool.pool_address)}
              className="text-left rounded-lg border p-3 transition-colors"
              style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--border-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>{pool.pair_name}</span>
                <span
                  className="text-xs font-bold px-1.5 py-0.5 rounded"
                  style={{
                    background: "rgba(48, 209, 88, 0.12)",
                    color: "var(--accent-green)",
                  }}
                >
                  {Math.round(pool.similarity_score * 100)}%
                </span>
              </div>
              <MiniSparkline
                data={pool.sparkline}
                color={isPositive ? "var(--accent-green)" : "var(--accent-red)"}
              />
              <div className="flex items-center justify-between mt-1.5 text-xs">
                <span style={{ color: "var(--text-muted)" }}>{formatUsd(pool.volume_24h)}</span>
                <span style={{ color: isPositive ? "var(--accent-green)" : "var(--accent-red)" }}>
                  {formatPercent(pool.price_change_24h)}
                </span>
              </div>
              <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{pool.dex}</div>
            </button>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex justify-end mt-3">
        <button
          onClick={() => {
            const query = encodeURIComponent(`SELECT p2.address, CONCAT(p2.token_base_symbol, '/', p2.token_quote_symbol) AS pair_name, p2.dex, p2.volume_24h, p2.price_change_24h FROM pools p1 JOIN pools p2 ON p1.token_base_address = p2.token_base_address AND p1.address != p2.address WHERE p1.address = '${poolAddress}' ORDER BY p2.volume_24h DESC LIMIT 10`);
            window.location.href = `/?page=sql-console&query=${query}`;
          }}
          className="flex items-center gap-1 text-xs transition-colors"
          style={{ color: "var(--text-muted)" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent-teal)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
        >
          <span className="font-mono">&gt;_</span> Query this in SQL Console →
        </button>
      </div>
    </div>
  );
}
