"use client";

import { useEffect, useState, useCallback } from "react";
import { formatUsd, formatPrice } from "@/lib/format";

/* ─── Types ────────────────────────────────────────────────────────── */

interface SimilarPool {
  pool_address: string;
  pair_name: string;
  dex: string;
  similarity_score: number;
  volume_24h: number;
  liquidity_usd: number;
  price_usd: number;
  price_change_1h?: number;
  price_change_6h?: number;
  price_change_24h: number;
}

interface ApiResponse {
  pool_address: string;
  query_time_ms: number;
  mode: string;
  method: string;
  htap_sql?: string;
  fallback?: boolean;
  results: SimilarPool[];
}

interface CorrelatedTokensProps {
  poolAddress: string;
  onNavigate: (address: string) => void;
}

/* ─── Custom Tooltip ────────────────────────────────────────────────── */

function InfoTooltip({ text, color }: { text: string; color: string }) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative inline-flex"
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <span className="material-symbols-outlined cursor-help"
        style={{ fontSize: 14, color, opacity: 0.5 }}>info</span>
      {show && (
        <span className="absolute left-1/2 bottom-full mb-1.5 -translate-x-1/2 z-50 px-3 py-2 rounded-lg text-xs leading-relaxed whitespace-normal pointer-events-none"
          style={{
            background: "var(--bg-primary)",
            border: "1px solid var(--border)",
            color: "var(--text-secondary)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            width: 220,
          }}>
          {text}
          <span className="absolute left-1/2 top-full -translate-x-1/2 -mt-px"
            style={{ width: 0, height: 0, borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: "5px solid var(--border)" }} />
        </span>
      )}
    </span>
  );
}

/* ─── Similarity Badge ─────────────────────────────────────────────── */

function SimilarityBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = pct >= 90 ? "var(--accent-green)" : pct >= 75 ? "var(--accent-orange)" : "var(--text-muted)";
  const bg = pct >= 90 ? "rgba(48,209,88,0.12)" : pct >= 75 ? "rgba(255,141,40,0.12)" : "rgba(102,102,102,0.12)";
  return <span className="text-xs font-bold px-1.5 py-0.5 rounded shrink-0" style={{ background: bg, color }}>{pct}%</span>;
}

/* ─── Behavior Card (with momentum pills) ─────────────────────────── */

function BehaviorCard({ pool, onNavigate }: { pool: SimilarPool; onNavigate: (a: string) => void }) {
  const [hovered, setHovered] = useState(false);
  const c1h = pool.price_change_1h ?? 0;
  const c6h = pool.price_change_6h ?? 0;
  const c24h = pool.price_change_24h;

  const changes = [c1h, c6h, c24h];
  const avg = changes.reduce((a, b) => a + b, 0) / 3;
  const allPos = changes.every(c => c >= 0);
  const allNeg = changes.every(c => c < 0);
  let icon: string, mColor: string, label: string, tooltip: string;
  if (allPos && avg > 5) { icon = "rocket_launch"; mColor = "var(--accent-green)"; label = "Strong pump"; tooltip = "All timeframes positive with avg change above +5% — strong upward momentum"; }
  else if (allPos) { icon = "trending_up"; mColor = "var(--accent-green)"; label = "Uptrend"; tooltip = "Price rising across all timeframes (1h, 6h, 24h)"; }
  else if (allNeg && avg < -5) { icon = "trending_down"; mColor = "var(--accent-red)"; label = "Dumping"; tooltip = "All timeframes negative with avg change below -5% — heavy sell pressure"; }
  else if (allNeg) { icon = "south_east"; mColor = "var(--accent-red)"; label = "Downtrend"; tooltip = "Price falling across all timeframes (1h, 6h, 24h)"; }
  else if (Math.abs(avg) < 2) { icon = "horizontal_rule"; mColor = "var(--text-muted)"; label = "Sideways"; tooltip = "Price moving within a narrow range — no clear direction"; }
  else { icon = "swap_vert"; mColor = "var(--accent-orange)"; label = "Volatile"; tooltip = "Mixed signals across timeframes — price swinging up and down"; }

  const pill = (l: string, v: number) => (
    <div className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium"
      style={{ background: v >= 0 ? "rgba(48,209,88,0.08)" : "rgba(255,66,89,0.08)", color: v >= 0 ? "var(--accent-green)" : "var(--accent-red)" }}>
      <span style={{ color: "var(--text-muted)" }}>{l}</span>
      <span>{v >= 0 ? "+" : ""}{v.toFixed(1)}%</span>
    </div>
  );

  return (
    <button onClick={() => onNavigate(pool.pool_address)}
      className="text-left rounded-xl border p-3 transition-all"
      style={{
        background: hovered ? "var(--bg-hover)" : "var(--bg-secondary)",
        borderColor: hovered ? "var(--accent-purple)" : "var(--border)",
        boxShadow: hovered ? "0 4px 12px rgba(219,52,242,0.1)" : "none",
        transform: hovered ? "translateY(-1px)" : "none",
      }}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold truncate mr-2" style={{ color: "var(--text-primary)" }}>{pool.pair_name}</span>
        <SimilarityBadge score={pool.similarity_score} />
      </div>
      <div className="flex items-center gap-1.5 mb-2">
        <span className="material-symbols-outlined" style={{ fontSize: 16, color: mColor }}>{icon}</span>
        <span className="text-xs" style={{ color: mColor }}>{label}</span>
        <InfoTooltip text={tooltip} color={mColor} />
      </div>
      <div className="flex items-center gap-1.5 flex-wrap mb-2">
        {pill("1h", c1h)}{pill("6h", c6h)}{pill("24h", c24h)}
      </div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-mono" style={{ color: "var(--text-secondary)" }}>{formatPrice(pool.price_usd)}</span>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>{pool.dex}</span>
      </div>
      <div className="text-xs" style={{ color: "var(--text-muted)" }}>Vol {formatUsd(pool.volume_24h)}</div>
    </button>
  );
}

/* ─── Skeleton ─────────────────────────────────────────────────────── */

function SkeletonCard() {
  return (
    <div className="rounded-xl border p-3 animate-pulse" style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
      <div className="flex justify-between mb-2">
        <div className="h-4 rounded" style={{ width: "55%", background: "var(--bg-hover)" }} />
        <div className="h-4 w-10 rounded" style={{ background: "var(--bg-hover)" }} />
      </div>
      <div className="h-3 rounded mb-2" style={{ width: "40%", background: "var(--bg-hover)" }} />
      <div className="flex gap-1 mb-2">
        <div className="h-4 w-14 rounded" style={{ background: "var(--bg-hover)" }} />
        <div className="h-4 w-14 rounded" style={{ background: "var(--bg-hover)" }} />
        <div className="h-4 w-16 rounded" style={{ background: "var(--bg-hover)" }} />
      </div>
      <div className="h-3 rounded mb-1" style={{ width: "35%", background: "var(--bg-hover)" }} />
      <div className="h-2.5 rounded" style={{ width: "55%", background: "var(--bg-hover)" }} />
    </div>
  );
}

/* ─── SQL Display ──────────────────────────────────────────────────── */

function SqlDisplay({ sql }: { sql: string }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const handleCopy = () => { navigator.clipboard.writeText(sql).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); };
  const highlighted = sql
    .replace(/(SELECT|FROM|WHERE|AND|ORDER BY|LIMIT|AS|DESC|JOIN|CROSS|WITH)\b/g, '<span style="color:var(--sql-keyword)">$1</span>')
    .replace(/(VEC_COSINE_DISTANCE|COUNT|CONCAT)\b/g, '<span style="color:var(--sql-function)">$1</span>')
    .replace(/(--[^\n]*)/g, '<span style="color:var(--sql-comment)">$1</span>')
    .replace(/('(?:[^'\\]|\\.)*')/g, '<span style="color:var(--sql-string)">$1</span>')
    .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span style="color:var(--sql-number)">$1</span>');
  return (
    <div className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--border)" }}>
      <button onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs transition-colors"
        style={{ background: "var(--bg-secondary)", color: "var(--text-muted)" }}
        onMouseEnter={e => e.currentTarget.style.color = "var(--accent-teal)"}
        onMouseLeave={e => e.currentTarget.style.color = "var(--text-muted)"}>
        <span className="flex items-center gap-1.5">
          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>{expanded ? "expand_less" : "expand_more"}</span>
          <span className="font-mono">&gt;_</span> View TiCI + Vector SQL
        </span>
        {expanded && (
          <button onClick={e => { e.stopPropagation(); handleCopy(); }}
            className="px-2 py-0.5 rounded text-[10px] font-medium"
            style={{ background: copied ? "rgba(48,209,88,0.12)" : "rgba(255,255,255,0.05)", color: copied ? "var(--accent-green)" : "var(--text-muted)" }}>
            {copied ? "Copied!" : "Copy"}
          </button>
        )}
      </button>
      {expanded && (
        <div className="px-3 py-2 font-mono text-[11px] leading-relaxed overflow-x-auto"
          style={{ background: "var(--bg-primary)", color: "var(--text-secondary)" }}
          dangerouslySetInnerHTML={{ __html: highlighted }} />
      )}
    </div>
  );
}

/* ─── Aggregate Summary ────────────────────────────────────────────── */

function AggregateSummary({ results }: { results: SimilarPool[] }) {
  if (results.length === 0) return null;

  // 1. DEX concentration: majority (4+) on same DEX (case-insensitive)
  const dexCounts: Record<string, { count: number; display: string }> = {};
  results.forEach(r => {
    const key = r.dex.toLowerCase();
    if (!dexCounts[key]) dexCounts[key] = { count: 0, display: r.dex };
    dexCounts[key].count += 1;
  });
  const topDex = Object.values(dexCounts).sort((a, b) => b.count - a.count)[0];
  if (topDex && topDex.count >= 4) {
    return (
      <div className="text-sm mb-3" style={{ color: "var(--text-muted)" }}>
        {topDex.count} of {results.length} matches are trading on {topDex.display}
      </div>
    );
  }

  // 2. Direction alignment: majority same direction (24h)
  const gainers = results.filter(r => r.price_change_24h >= 0);
  const losers = results.filter(r => r.price_change_24h < 0);
  if (gainers.length >= 4) {
    const avgGain = gainers.reduce((s, r) => s + r.price_change_24h, 0) / gainers.length;
    return (
      <div className="text-sm mb-3" style={{ color: "var(--text-muted)" }}>
        {gainers.length} of {results.length} tokens show 24h gains{avgGain > 20 ? ` above +${Math.round(avgGain)}%` : ""}
      </div>
    );
  }
  if (losers.length >= 4) {
    return (
      <div className="text-sm mb-3" style={{ color: "var(--text-muted)" }}>
        {losers.length} of {results.length} tokens are down in the last 24h
      </div>
    );
  }

  // 3. Volatility pattern: majority "Volatile"
  const volatileCount = results.filter(r => {
    const c1h = r.price_change_1h ?? 0;
    const c6h = r.price_change_6h ?? 0;
    const c24h = r.price_change_24h;
    const allPos = [c1h, c6h, c24h].every(c => c >= 0);
    const allNeg = [c1h, c6h, c24h].every(c => c < 0);
    const avg = Math.abs((c1h + c6h + c24h) / 3);
    return !allPos && !allNeg && avg >= 2;
  }).length;
  if (volatileCount >= 4) {
    return (
      <div className="text-sm mb-3" style={{ color: "var(--text-muted)" }}>
        Most matches are showing high volatility
      </div>
    );
  }

  // 4. Fallback: show nothing
  return null;
}

/* ─── Main Component ───────────────────────────────────────────────── */

export function SimilarPatterns({ poolAddress, onNavigate }: CorrelatedTokensProps) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/pool/${poolAddress}/similar?limit=6&mode=behavior`);
      if (!res.ok) {
        if (res.status === 404) throw new Error("not_found");
        if (res.status >= 500) throw new Error("server_error");
        throw new Error("fetch_failed");
      }
      const json: ApiResponse = await res.json();
      setData(json);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      setError(msg);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [poolAddress]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div className="rounded-lg border p-4" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
      {/* ── Header ── */}
      <div className="mb-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="material-symbols-outlined" style={{ fontSize: 18, color: "var(--accent-purple)" }}>auto_awesome</span>
          <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Correlated Tokens</span>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
            style={{ border: "1px solid var(--accent-purple)", color: "var(--accent-purple)" }}>TiDB Vector Search</span>
          {data?.method === "tici_vector_cosine" && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
              style={{ border: "1px solid var(--accent-teal)", color: "var(--accent-teal)" }}>HTAP</span>
          )}
          {data?.query_time_ms != null && data.query_time_ms > 0 && (
            <span className="text-xs ml-auto font-mono" style={{ color: "var(--accent-green)" }}>{data.query_time_ms}ms</span>
          )}
        </div>
      </div>

      {/* ── Subtitle ── */}
      <div className="text-[11px] mb-3" style={{ color: "var(--text-muted)" }}>
        Tokens with similar momentum, volume, and trading pressure right now
      </div>

      {/* ── Content: Loading ── */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>

      /* ── Content: Error ── */
      ) : error ? (
        <div className="text-center py-8">
          <span className="material-symbols-outlined mb-2 block" style={{ fontSize: 32, color: "var(--accent-red)" }}>
            {error === "not_found" ? "help_outline" : "cloud_off"}
          </span>
          <div className="text-sm mb-1" style={{ color: "var(--text-secondary)" }}>
            {error === "not_found"
              ? "This token doesn\u2019t have enough data for correlation analysis yet"
              : error === "server_error"
              ? "Vector search service is temporarily unavailable"
              : "Failed to load correlated tokens"}
          </div>
          <div className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
            {error === "not_found"
              ? "Embeddings are generated periodically \u2014 check back later"
              : "This may be a temporary issue with the database connection"}
          </div>
          <button onClick={fetchData}
            className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors"
            style={{ borderColor: "var(--accent-purple)", color: "var(--accent-purple)", background: "transparent" }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(124,58,237,0.1)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
            <span className="material-symbols-outlined align-middle mr-1" style={{ fontSize: 14 }}>refresh</span>
            Try again
          </button>
        </div>

      /* ── Content: Empty ── */
      ) : !data || data.results.length === 0 ? (
        <div className="text-center py-8">
          <span className="material-symbols-outlined mb-2 block" style={{ fontSize: 32, color: "var(--text-muted)" }}>search_off</span>
          <div className="text-sm mb-1" style={{ color: "var(--text-secondary)" }}>No correlated tokens found</div>
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>
            No tokens with similar market behavior were detected for this pool
          </div>
        </div>

      /* ── Content: Results ── */
      ) : (
        <>
          {/* ── Aggregate Summary ── */}
          <AggregateSummary results={data.results} />

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.results.map((pool) => (
              <BehaviorCard key={pool.pool_address} pool={pool} onNavigate={onNavigate} />
            ))}
          </div>
          {data.htap_sql && <div className="mt-4"><SqlDisplay sql={data.htap_sql} /></div>}
        </>
      )}
    </div>
  );
}
