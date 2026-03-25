"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

/* ── Types ───────────────────────────────────────────────── */

interface TokenResult {
  address: string;
  token_base_symbol: string;
  token_quote_symbol: string;
  token_base_address: string;
  token_name: string | null;
  price_usd: number;
  volume_24h: number;
  price_change_24h: number;
  logo_url: string | null;
  dex: string;
  holder_count?: number | null;
  top10_holder_pct?: number | null;
  txns_24h?: number;
  whale_events_24h?: number;
  pool_created_at?: number | null;
}

interface EventResult {
  id: number;
  event_type: string;
  severity: string;
  description: string;
  usd_value: number;
  pool_address: string;
  token_symbol: string | null;
  timestamp: number;
  dex: string;
}

interface TrendingData {
  gainers: TokenResult[];
  whale_alerts: EventResult[];
  new_pools: TokenResult[];
  query_time_ms: number;
}

interface SearchBarProps {
  value?: string;
}

/* ── Constants ───────────────────────────────────────────── */

const PLACEHOLDER_HINTS = [
  "Search tokens, pools, or addresses...",
  'Try "dog tokens" or "meme coins"...',
  'Try "BONK" or "whale activity"...',
  "Paste a token address to find it...",
];

const EVENT_ICONS: Record<string, { icon: string; color: string }> = {
  whale: { icon: "waves", color: "#0091FF" },
  large_trade: { icon: "swap_horiz", color: "#888" },
  smart_money: { icon: "psychology", color: "#818CF8" },
  liquidity_add: { icon: "water_drop", color: "#DB34F2" },
  liquidity_remove: { icon: "water_drop", color: "#DB34F2" },
  new_pool: { icon: "add_circle", color: "#30D158" },
};

/* ── Helpers ─────────────────────────────────────────────── */

function formatPrice(price: number): string {
  if (!price) return "$0";
  if (price < 0.0001) {
    const str = price.toFixed(20);
    const afterDot = str.split(".")[1] || "";
    let zeros = 0;
    for (const c of afterDot) {
      if (c === "0") zeros++;
      else break;
    }
    const sig = afterDot.slice(zeros, zeros + 3).replace(/0+$/, "");
    const sub = String.fromCodePoint(
      ...`${zeros}`.split("").map((d) => 0x2080 + Number(d))
    );
    return `$0.0${sub}${sig}`;
  }
  if (price < 1) return `$${price.toFixed(6)}`;
  return `$${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function formatVolume(vol: number): string {
  if (vol >= 1e6) return `$${(vol / 1e6).toFixed(1)}M`;
  if (vol >= 1e3) return `$${(vol / 1e3).toFixed(0)}K`;
  return `$${vol.toFixed(0)}`;
}

function formatCompact(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

function timeAgo(ts: number): string {
  const now = Date.now();
  const seconds = Math.floor((now - ts) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function isNewPool(poolCreatedAt: number | null | undefined): boolean {
  if (!poolCreatedAt) return false;
  const oneDayMs = 86_400_000;
  // pool_created_at could be seconds or ms
  const ts = poolCreatedAt > 1e12 ? poolCreatedAt : poolCreatedAt * 1000;
  return Date.now() - ts < oneDayMs;
}

/* ── Component ───────────────────────────────────────────── */

export function SearchBar({}: SearchBarProps) {
  const [local, setLocal] = useState("");
  const [tokenResults, setTokenResults] = useState<TokenResult[]>([]);
  const [eventResults, setEventResults] = useState<EventResult[]>([]);
  const [trending, setTrending] = useState<TrendingData | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchEngine, setSearchEngine] = useState("");
  const [queryInterpreted, setQueryInterpreted] = useState<string | undefined>();
  const [queryTimeMs, setQueryTimeMs] = useState(0);
  const [loading, setLoading] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const searchTimer = useRef<NodeJS.Timeout>();
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  /* ── Rotate placeholder ──────────────────────────────── */
  useEffect(() => {
    if (isFocused || local) return;
    const interval = setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % PLACEHOLDER_HINTS.length);
    }, 4000);
    return () => clearInterval(interval);
  }, [isFocused, local]);

  /* ── Fetch trending on focus (empty query) ───────────── */
  const fetchTrending = useCallback(() => {
    if (trending) return; // already cached
    fetch("/api/search/trending")
      .then((r) => r.json())
      .then((data) => {
        if (data.gainers) setTrending(data);
      })
      .catch(() => {});
  }, [trending]);

  /* ── Debounced search API call ───────────────────────── */
  const fetchResults = useCallback((query: string) => {
    clearTimeout(searchTimer.current);
    if (query.length < 2) {
      setTokenResults([]);
      setEventResults([]);
      return;
    }
    setLoading(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(query)}`
        );
        const data = await res.json();
        setTokenResults(data.tokens || []);
        setEventResults(data.events || []);
        setSearchEngine(data.search_engine || "");
        setQueryInterpreted(data.query_interpreted);
        setQueryTimeMs(data.query_time_ms || 0);
        setShowDropdown(true);
      } catch {
        setTokenResults([]);
        setEventResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  }, []);

  useEffect(() => {
    fetchResults(local);
    return () => clearTimeout(searchTimer.current);
  }, [local, fetchResults]);

  /* ── Outside click ───────────────────────────────────── */
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleSelectPool(pool: TokenResult) {
    setShowDropdown(false);
    setLocal("");
    router.push(`/pool/${pool.address}`);
  }

  function handleSelectEvent(event: EventResult) {
    setShowDropdown(false);
    setLocal("");
    if (event.pool_address) router.push(`/pool/${event.pool_address}`);
  }

  /* ── Determine dropdown mode ─────────────────────────── */
  const hasQuery = local.length >= 2;
  const hasResults = tokenResults.length > 0 || eventResults.length > 0;
  const showTrending = !hasQuery && isFocused && trending;

  /* ── Render ──────────────────────────────────────────── */
  return (
    <div ref={containerRef} className="relative flex-1 min-w-[200px] max-w-lg">
      {/* Search input */}
      <span
        className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2"
        style={{
          fontSize: 18,
          color: isFocused ? "var(--accent-blue)" : "var(--text-muted)",
        }}
      >
        search
      </span>
      <input
        type="text"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onFocus={() => {
          setIsFocused(true);
          if (!local) fetchTrending();
          setShowDropdown(true);
        }}
        onBlur={() => setIsFocused(false)}
        placeholder={PLACEHOLDER_HINTS[placeholderIdx]}
        className="w-full h-10 pl-10 pr-9 rounded-xl text-sm border outline-none transition-all"
        style={{
          background: "var(--bg-card)",
          borderColor: isFocused ? "var(--accent-blue)" : "var(--border)",
          color: "var(--text-primary)",
          boxShadow: isFocused
            ? "0 0 0 3px rgba(99, 102, 241, 0.15)"
            : "none",
        }}
      />
      {local && (
        <button
          onClick={() => {
            setLocal("");
            setShowDropdown(false);
          }}
          className="absolute right-3 top-1/2 -translate-y-1/2"
          style={{ color: "var(--text-muted)" }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
            close
          </span>
        </button>
      )}

      {/* ── Dropdown ──────────────────────────────────── */}
      {showDropdown && (showTrending || hasQuery) && (
        <div
          className="absolute top-full left-0 mt-1.5 z-50 rounded-xl border overflow-hidden"
          style={{
            background: "var(--bg-card)",
            borderColor: "var(--border)",
            maxHeight: 520,
            minWidth: 460,
            width: "max(100%, 460px)",
            boxShadow: "0 12px 32px rgba(0,0,0,0.4)",
          }}
        >
          {/* ── Trending state (empty query) ──────── */}
          {showTrending && !hasQuery && (
            <div className="overflow-y-auto" style={{ maxHeight: 460 }}>
              {/* Top Gainers */}
              {trending.gainers.length > 0 && (
                <>
                  <SectionHeader icon="trending_up" color="var(--accent-green)" label="Top Gainers" />
                  {trending.gainers.map((r) => (
                    <TokenRow
                      key={r.address}
                      token={r}
                      onSelect={handleSelectPool}
                    />
                  ))}
                </>
              )}

              {/* Whale Alerts */}
              {trending.whale_alerts.length > 0 && (
                <>
                  <SectionHeader icon="waves" color="#0091FF" label="Whale Alerts" />
                  {trending.whale_alerts.map((e) => (
                    <EventRow
                      key={e.id}
                      event={e}
                      onSelect={handleSelectEvent}
                    />
                  ))}
                </>
              )}

              {/* New Pools */}
              {trending.new_pools.length > 0 && (
                <>
                  <SectionHeader icon="add_circle" color="var(--accent-green)" label="New Pools" />
                  {trending.new_pools.map((r) => (
                    <TokenRow
                      key={r.address}
                      token={r}
                      onSelect={handleSelectPool}
                      showAge
                    />
                  ))}
                </>
              )}

              <Footer
                engine="tici"
                timeMs={0}
                label="Discovery"
              />
            </div>
          )}

          {/* ── Search results state ──────────────── */}
          {hasQuery && (
            <>
              {/* Interpreted query hint */}
              {queryInterpreted &&
                queryInterpreted !== local.toLowerCase() &&
                hasResults && (
                  <div
                    className="px-4 py-2 text-[11px] border-b flex items-center gap-1.5"
                    style={{
                      borderColor: "var(--border)",
                      color: "var(--text-muted)",
                    }}
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 13 }}
                    >
                      auto_awesome
                    </span>
                    Showing results for:{" "}
                    <strong style={{ color: "var(--text-secondary)" }}>
                      {queryInterpreted}
                    </strong>
                  </div>
                )}

              {/* Loading skeleton */}
              {loading && !hasResults ? (
                <div className="px-4 py-3 flex flex-col gap-2.5">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="search-skeleton w-9 h-9 rounded-full shrink-0" />
                      <div className="flex-1 flex flex-col gap-1.5">
                        <div className="search-skeleton h-3.5 w-24 rounded" />
                        <div className="search-skeleton h-2.5 w-16 rounded" />
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        <div className="search-skeleton h-3.5 w-16 rounded" />
                        <div className="search-skeleton h-2.5 w-12 rounded" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : !hasResults ? (
                <div
                  className="px-4 py-6 text-center text-xs"
                  style={{ color: "var(--text-muted)" }}
                >
                  No results found
                </div>
              ) : (
                <div
                  className="overflow-y-auto"
                  style={{ maxHeight: 460 }}
                >
                  {/* Token results */}
                  {tokenResults.length > 0 && (
                    <>
                      <SectionHeader
                        icon="token"
                        color="var(--accent-blue)"
                        label={`Tokens (${tokenResults.length})`}
                      />
                      {tokenResults.map((r) => (
                        <TokenRow
                          key={r.address}
                          token={r}
                          onSelect={handleSelectPool}
                          showEnrichment
                        />
                      ))}
                    </>
                  )}

                  {/* Event results */}
                  {eventResults.length > 0 && (
                    <>
                      <SectionHeader
                        icon="bolt"
                        color="var(--accent-orange)"
                        label={`Events (${eventResults.length})`}
                      />
                      {eventResults.map((e) => (
                        <EventRow
                          key={e.id}
                          event={e}
                          onSelect={handleSelectEvent}
                        />
                      ))}
                    </>
                  )}
                </div>
              )}

              {hasResults && (
                <Footer
                  engine={searchEngine}
                  timeMs={queryTimeMs}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Sub-components ──────────────────────────────────────── */

function SectionHeader({
  icon,
  color,
  label,
}: {
  icon: string;
  color: string;
  label: string;
}) {
  return (
    <div
      className="px-4 py-2 flex items-center gap-1.5 border-b"
      style={{ borderColor: "var(--border)" }}
    >
      <span
        className="material-symbols-outlined"
        style={{ fontSize: 14, color }}
      >
        {icon}
      </span>
      <span
        className="text-[10px] font-semibold tracking-wider uppercase"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </span>
    </div>
  );
}

function TokenRow({
  token,
  onSelect,
  showEnrichment,
  showAge,
}: {
  token: TokenResult;
  onSelect: (t: TokenResult) => void;
  showEnrichment?: boolean;
  showAge?: boolean;
}) {
  const isNew = isNewPool(token.pool_created_at);

  return (
    <button
      onMouseDown={(e) => {
        e.preventDefault(); // prevent blur from closing dropdown before click
        onSelect(token);
      }}
      className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[var(--bg-hover)] transition-colors border-b"
      style={{ borderColor: "var(--border)" }}
    >
      {/* Token icon */}
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 overflow-hidden"
        style={{
          background: token.logo_url ? "transparent" : "var(--bg-hover)",
          color: "var(--text-secondary)",
        }}
      >
        {token.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={token.logo_url}
            alt=""
            className="w-full h-full object-cover"
          />
        ) : (
          token.token_base_symbol?.slice(0, 2)
        )}
      </div>

      {/* Token info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className="text-sm font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            {token.token_base_symbol}
          </span>
          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            /{token.token_quote_symbol}
          </span>
          <span
            className="text-[9px] px-1.5 py-0.5 rounded"
            style={{
              background: "var(--bg-hover)",
              color: "var(--text-muted)",
            }}
          >
            {token.dex}
          </span>
          {isNew && (
            <span className="search-new-badge">NEW</span>
          )}
        </div>

        {/* Second line: name + address + enrichment badges */}
        <div className="flex items-center gap-2 mt-0.5">
          {token.token_name && (
            <span
              className="text-[11px] truncate"
              style={{ color: "var(--text-muted)", maxWidth: 120 }}
            >
              {token.token_name}
            </span>
          )}
          {token.token_base_address && (
            <span
              className="text-[10px] font-mono"
              style={{ color: "var(--text-muted)", opacity: 0.6 }}
            >
              {token.token_base_address.slice(0, 4)}...{token.token_base_address.slice(-4)}
            </span>
          )}
          {showEnrichment && (
            <div className="flex items-center gap-2">
              {token.holder_count != null && token.holder_count > 0 && (
                <span
                  className="text-[10px] flex items-center gap-0.5"
                  style={{ color: "var(--text-muted)" }}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 12 }}
                  >
                    group
                  </span>
                  {formatCompact(token.holder_count)}
                </span>
              )}
              {(token.txns_24h ?? 0) > 0 && (
                <span
                  className="text-[10px]"
                  style={{ color: "var(--text-muted)" }}
                >
                  {formatCompact(token.txns_24h!)} txns
                </span>
              )}
              {(token.whale_events_24h ?? 0) > 0 && (
                <span className="search-whale-indicator">
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 11 }}
                  >
                    waves
                  </span>
                  {token.whale_events_24h}
                </span>
              )}
            </div>
          )}
          {showAge && token.pool_created_at && (
            <span
              className="text-[10px]"
              style={{ color: "var(--text-muted)" }}
            >
              {timeAgo(
                token.pool_created_at > 1e12
                  ? token.pool_created_at
                  : token.pool_created_at * 1000
              )}{" "}
              ago
            </span>
          )}
        </div>
      </div>

      {/* Price + volume + change */}
      <div className="text-right shrink-0">
        <div className="flex items-center justify-end gap-1.5">
          <span
            className="text-sm font-medium"
            style={{ color: "var(--text-primary)" }}
          >
            {formatPrice(Number(token.price_usd))}
          </span>
          <span
            className="text-[10px] font-medium"
            style={{
              color:
                Number(token.price_change_24h) >= 0
                  ? "var(--accent-green)"
                  : "var(--accent-red)",
            }}
          >
            {Number(token.price_change_24h) >= 0 ? "+" : ""}
            {Number(token.price_change_24h).toFixed(1)}%
          </span>
        </div>
        <div
          className="text-[10px] mt-0.5"
          style={{ color: "var(--text-muted)" }}
        >
          Vol {formatVolume(Number(token.volume_24h))}
        </div>
      </div>
    </button>
  );
}

function EventRow({
  event,
  onSelect,
}: {
  event: EventResult;
  onSelect: (e: EventResult) => void;
}) {
  const config = EVENT_ICONS[event.event_type] || EVENT_ICONS.large_trade;

  return (
    <button
      onMouseDown={(e) => {
        e.preventDefault();
        onSelect(event);
      }}
      className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[var(--bg-hover)] transition-colors border-b"
      style={{ borderColor: "var(--border)" }}
    >
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
        style={{ background: `${config.color}20` }}
      >
        <span
          className="material-symbols-outlined"
          style={{ fontSize: 16, color: config.color }}
        >
          {config.icon}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div
          className="text-[12px] truncate"
          style={{ color: "var(--text-primary)" }}
        >
          {event.description}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          {event.token_symbol && (
            <span
              className="text-[10px] font-medium"
              style={{ color: "var(--text-secondary)" }}
            >
              {event.token_symbol}
            </span>
          )}
          {event.usd_value > 0 && (
            <span
              className="text-[10px]"
              style={{ color: "var(--accent-green)" }}
            >
              {formatVolume(Number(event.usd_value))}
            </span>
          )}
          {event.dex && (
            <span
              className="text-[10px]"
              style={{ color: "var(--text-muted)" }}
            >
              {event.dex}
            </span>
          )}
        </div>
      </div>
      <span
        className="text-[10px] shrink-0"
        style={{ color: "var(--text-muted)" }}
      >
        {timeAgo(event.timestamp)}
      </span>
    </button>
  );
}

function Footer({
  engine,
  timeMs,
  label,
}: {
  engine: string;
  timeMs: number;
  label?: string;
}) {
  return (
    <div
      className="px-4 py-2.5 flex items-center justify-center gap-2 border-t"
      style={{
        borderColor: "var(--border)",
        background:
          engine === "tici"
            ? "linear-gradient(135deg, rgba(99, 102, 241, 0.08), rgba(219, 52, 242, 0.05))"
            : "var(--bg-secondary)",
      }}
    >
      {engine === "tici" ? (
        <>
          <span
            className="material-symbols-outlined search-badge-sparkle"
            style={{ fontSize: 14, color: "var(--accent-blue)" }}
          >
            auto_awesome
          </span>
          <span
            className="text-[11px] font-medium"
            style={{ color: "var(--text-secondary)" }}
          >
            {label ? `${label} ` : ""}Powered by{" "}
            <span className="search-badge-gradient-text">
              TiDB Full-Text Search
            </span>
          </span>
          {timeMs > 0 && (
            <>
              <span
                className="text-[10px]"
                style={{ color: "var(--border-hover)" }}
              >
                |
              </span>
              <span className="search-query-time">{timeMs}ms</span>
            </>
          )}
        </>
      ) : (
        <>
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 14, color: "var(--text-muted)" }}
          >
            search
          </span>
          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            Basic keyword match
          </span>
          {timeMs > 0 && (
            <>
              <span
                className="text-[10px]"
                style={{ color: "var(--border-hover)" }}
              >
                |
              </span>
              <span className="search-query-time">{timeMs}ms</span>
            </>
          )}
        </>
      )}
    </div>
  );
}
