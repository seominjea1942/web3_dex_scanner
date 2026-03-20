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
import { SqlConsole } from "@/components/sql-console/SqlConsole";
import { ToastContainer } from "@/components/ui/Toast";

export default function Home() {
  const bp = useBreakpoint();
  const [perfExpanded, setPerfExpanded] = useState(false);
  const [eventsOpen, setEventsOpen] = useState(false);
  const [activePage, setActivePage] = useState<"screener" | "sql-console">("screener");

  return (
    <main className="min-h-screen flex flex-col" style={{ background: "var(--bg-primary)" }}>
      <Navbar activePage={activePage} onNavigate={(page) => setActivePage(page as "screener" | "sql-console")} />
      {activePage === "sql-console" ? (
        /* SQL Console — full width, no event sidebar */
        <div className="flex-1 pb-12">
          <EventTicker onClick={() => {}} />
          <SqlConsole />
        </div>
      ) : (
        <>
          <Banner />
          {/* Mobile event ticker */}
          {bp !== "desktop" && !eventsOpen && <EventTicker onClick={() => setEventsOpen(true)} />}

          {/* Main content */}
          <div className={bp === "desktop" ? "relative" : "flex flex-1 pb-12"}>
            {bp !== "desktop" && eventsOpen ? (
              <MobileEventSheet onClose={() => setEventsOpen(false)} />
            ) : (
              <>
                <div className={bp === "desktop" ? "mr-80 pb-12" : "flex-1 min-w-0"}>
                  <PoolTable />
                </div>
                {bp === "desktop" && (
                  <div className="absolute top-0 right-0 bottom-0 w-80">
                    <EventPanel />
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* Performance bar */}
      {perfExpanded ? (
        <PerformanceExpanded onCollapse={() => setPerfExpanded(false)} />
      ) : (
        <PerformanceBar onExpand={() => setPerfExpanded(true)} />
      )}
      <ToastContainer />
    </main>
  );
}
