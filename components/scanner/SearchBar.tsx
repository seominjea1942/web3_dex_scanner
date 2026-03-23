"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

interface SearchResult {
  address: string;
  token_base_symbol: string;
  token_quote_symbol: string;
  token_name: string | null;
  price_usd: number;
  volume_24h: number;
  price_change_24h: number;
  logo_url: string | null;
  dex: string;
}

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
}

export function SearchBar({ value, onChange }: SearchBarProps) {
  const [local, setLocal] = useState(value);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchEngine, setSearchEngine] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const timer = useRef<NodeJS.Timeout>();
  const searchTimer = useRef<NodeJS.Timeout>();
  const onChangeRef = useRef(onChange);
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  onChangeRef.current = onChange;

  // Debounced filter pass-through (existing behavior)
  useEffect(() => {
    timer.current = setTimeout(() => onChangeRef.current(local), 300);
    return () => clearTimeout(timer.current);
  }, [local]);

  // Debounced search API call for dropdown
  const fetchResults = useCallback((query: string) => {
    clearTimeout(searchTimer.current);
    if (query.length < 2) {
      setResults([]);
      setShowDropdown(false);
      return;
    }
    setLoading(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setResults(data.results || []);
        setSearchEngine(data.search_engine || "");
        setShowDropdown(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  }, []);

  useEffect(() => {
    fetchResults(local);
    return () => clearTimeout(searchTimer.current);
  }, [local, fetchResults]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleSelect(pool: SearchResult) {
    setShowDropdown(false);
    setLocal("");
    onChangeRef.current("");
    router.push(`/pool/${pool.address}`);
  }

  function formatPrice(price: number): string {
    if (!price) return "$0";
    if (price < 0.0001) return `$${price.toExponential(2)}`;
    if (price < 1) return `$${price.toFixed(6)}`;
    return `$${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }

  function formatVolume(vol: number): string {
    if (vol >= 1e6) return `$${(vol / 1e6).toFixed(1)}M`;
    if (vol >= 1e3) return `$${(vol / 1e3).toFixed(0)}K`;
    return `$${vol.toFixed(0)}`;
  }

  return (
    <div ref={containerRef} className="relative flex-1 min-w-[200px] max-w-sm">
      <span
        className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2"
        style={{ fontSize: 16, color: "var(--text-muted)" }}
      >
        search
      </span>
      <input
        type="text"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onFocus={() => results.length > 0 && setShowDropdown(true)}
        placeholder="Search tokens, pools, or addresses..."
        className="w-full h-8 pl-9 pr-8 rounded-lg text-sm border outline-none transition-colors"
        style={{
          background: "var(--bg-card)",
          borderColor: "var(--border)",
          color: "var(--text-primary)",
        }}
      />
      {local && (
        <button
          onClick={() => { setLocal(""); onChangeRef.current(""); setShowDropdown(false); }}
          className="absolute right-3 top-1/2 -translate-y-1/2"
          style={{ color: "var(--text-muted)" }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>close</span>
        </button>
      )}

      {/* Dropdown results */}
      {showDropdown && (
        <div
          className="absolute top-full left-0 right-0 mt-1 z-50 rounded-lg border shadow-lg overflow-hidden"
          style={{
            background: "var(--bg-card)",
            borderColor: "var(--border)",
            maxHeight: 360,
          }}
        >
          {loading && results.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs" style={{ color: "var(--text-muted)" }}>
              Searching...
            </div>
          ) : results.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs" style={{ color: "var(--text-muted)" }}>
              No results found
            </div>
          ) : (
            <>
              <div className="overflow-y-auto" style={{ maxHeight: 320 }}>
                {results.map((r) => (
                  <button
                    key={r.address}
                    onClick={() => handleSelect(r)}
                    className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-[var(--bg-hover)] transition-colors"
                  >
                    {/* Token icon */}
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 overflow-hidden"
                      style={{
                        background: r.logo_url ? "transparent" : "var(--bg-hover)",
                        color: "var(--text-secondary)",
                      }}
                    >
                      {r.logo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.logo_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        r.token_base_symbol?.slice(0, 2)
                      )}
                    </div>

                    {/* Token info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                          {r.token_base_symbol}
                        </span>
                        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                          /{r.token_quote_symbol}
                        </span>
                        <span
                          className="text-[9px] px-1 py-0.5 rounded"
                          style={{ background: "var(--bg-hover)", color: "var(--text-muted)" }}
                        >
                          {r.dex}
                        </span>
                      </div>
                      {r.token_name && (
                        <div className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>
                          {r.token_name}
                        </div>
                      )}
                    </div>

                    {/* Price + volume */}
                    <div className="text-right shrink-0">
                      <div className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
                        {formatPrice(Number(r.price_usd))}
                      </div>
                      <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                        Vol {formatVolume(Number(r.volume_24h))}
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              {/* Footer badge */}
              <div
                className="px-3 py-1.5 text-[9px] text-center border-t"
                style={{
                  borderColor: "var(--border)",
                  color: "var(--text-muted)",
                  background: "var(--bg-secondary)",
                }}
              >
                {searchEngine === "tici" ? (
                  <>Powered by <span style={{ color: "var(--accent-blue)" }}>TiCI Full-Text Search</span></>
                ) : (
                  <>Search via LIKE fallback</>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
