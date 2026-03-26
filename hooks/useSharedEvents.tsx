"use client";

import React, { createContext, useContext, useCallback } from "react";
import { usePolling } from "./usePolling";
import { POLLING_INTERVALS } from "@/lib/constants";
import type { DefiEvent } from "@/lib/types";

interface EventsData {
  /** Unfiltered "all" events (limit 50) – shared across ticker, panel, mobile sheet */
  events: DefiEvent[] | null;
  loading: boolean;
}

const EventsContext = createContext<EventsData>({ events: null, loading: true });

export function SharedEventsProvider({ children }: { children: React.ReactNode }) {
  const fetcher = useCallback(
    () =>
      fetch("/api/events?limit=50")
        .then((r) => r.json())
        .then((d) => d.events as DefiEvent[]),
    []
  );

  const { data, loading } = usePolling(fetcher, POLLING_INTERVALS.EVENTS);

  return (
    <EventsContext.Provider value={{ events: data, loading }}>
      {children}
    </EventsContext.Provider>
  );
}

/** Consume the single shared events fetch. */
export function useSharedEvents(): EventsData {
  return useContext(EventsContext);
}
