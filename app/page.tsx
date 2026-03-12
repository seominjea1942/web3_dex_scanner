"use client";

import { useState } from "react";
import { useBreakpoint } from "@/hooks/useBreakpoint";
import { Navbar } from "@/components/layout/Navbar";
import { Banner } from "@/components/layout/Banner";
import { PoolTable } from "@/components/scanner/PoolTable";
import { EventPanel } from "@/components/events/EventPanel";
import { EventTicker } from "@/components/events/EventTicker";
import { MobileEventSheet } from "@/components/events/MobileEventSheet";
import { PerformanceBar } from "@/components/performance/PerformanceBar";
import { PerformanceExpanded } from "@/components/performance/PerformanceExpanded";

export default function Home() {
  const bp = useBreakpoint();
  const [perfExpanded, setPerfExpanded] = useState(false);
  const [eventsOpen, setEventsOpen] = useState(false);

  return (
    <main className="min-h-screen flex flex-col" style={{ background: "var(--bg-primary)" }}>
      <Navbar />
      <Banner />

      {/* Mobile event ticker */}
      {bp !== "desktop" && !eventsOpen && <EventTicker onClick={() => setEventsOpen(true)} />}

      {/* Main content */}
      <div className="flex flex-1 pb-12">
        {bp !== "desktop" && eventsOpen ? (
          <MobileEventSheet onClose={() => setEventsOpen(false)} />
        ) : (
          <>
            <PoolTable />
            {bp === "desktop" && <EventPanel />}
          </>
        )}
      </div>

      {/* Performance bar */}
      {perfExpanded ? (
        <PerformanceExpanded onCollapse={() => setPerfExpanded(false)} />
      ) : (
        <PerformanceBar onExpand={() => setPerfExpanded(true)} />
      )}
    </main>
  );
}
