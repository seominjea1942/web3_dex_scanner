"use client";

import { useState, useEffect, useRef, useCallback } from "react";

export function usePolling<T>(
  fetcher: () => Promise<T>,
  intervalMs: number,
  enabled = true,
  resetKey?: string | number | null
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  // Generation counter — incremented every time the effect restarts.
  // In-flight fetches whose generation doesn't match are discarded,
  // preventing stale responses from overwriting fresh data.
  const genRef = useRef(0);

  // Combined polling + reset effect.
  // Restarts (clears old interval, bumps generation) whenever
  // resetKey, intervalMs, or enabled changes.
  useEffect(() => {
    if (!enabled) return;
    const gen = ++genRef.current;

    const doFetch = async () => {
      try {
        const result = await fetcherRef.current();
        if (genRef.current === gen) {
          setData(result);
          setError(null);
          setLoading(false);
        }
      } catch (e) {
        if (genRef.current === gen) {
          setError(e instanceof Error ? e.message : "Fetch error");
          setLoading(false);
        }
      }
    };

    doFetch();
    const id = setInterval(doFetch, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled, resetKey]);

  // Manual refresh that respects the current generation
  const refresh = useCallback(async () => {
    const gen = genRef.current;
    try {
      const result = await fetcherRef.current();
      if (genRef.current === gen) {
        setData(result);
        setError(null);
      }
    } catch (e) {
      if (genRef.current === gen) {
        setError(e instanceof Error ? e.message : "Fetch error");
      }
    }
  }, []);

  return { data, loading, error, refresh };
}
