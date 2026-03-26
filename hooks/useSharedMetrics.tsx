"use client";

import React, { createContext, useContext, useCallback } from "react";
import { usePolling } from "./usePolling";
import { POLLING_INTERVALS } from "@/lib/constants";

export interface MetricsResponse {
  metrics: Record<string, number>;
  sparklines: Record<string, number[]>;
}

const MetricsContext = createContext<{ data: MetricsResponse | null; loading: boolean }>({
  data: null,
  loading: true,
});

export function SharedMetricsProvider({ children }: { children: React.ReactNode }) {
  const fetcher = useCallback(
    () => fetch("/api/metrics").then((r) => r.json()) as Promise<MetricsResponse>,
    []
  );

  const { data, loading } = usePolling(fetcher, POLLING_INTERVALS.METRICS);

  return (
    <MetricsContext.Provider value={{ data, loading }}>
      {children}
    </MetricsContext.Provider>
  );
}

/** Consume the single shared metrics fetch. */
export function useSharedMetrics() {
  return useContext(MetricsContext);
}
