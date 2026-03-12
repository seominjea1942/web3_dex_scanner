"use client";

import { useState } from "react";
import { useTheme } from "@/app/providers";

const NAV_ITEMS = [
  { label: "DEX Screener", href: "/", active: true },
  { label: "Portfolio", href: "#", comingSoon: true },
  { label: "SQL Console", href: "#", comingSoon: true },
];

export function Navbar() {
  const { theme, toggleTheme } = useTheme();
  const [showChainMenu, setShowChainMenu] = useState(false);
  const [comingSoonMsg, setComingSoonMsg] = useState<string | null>(null);

  return (
    <nav
      className="sticky top-0 z-50 flex items-center justify-between px-4 py-2 border-b"
      style={{
        background: "var(--bg-secondary)",
        borderColor: "var(--border)",
      }}
    >
      {/* Left: Logo + Nav */}
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold"
            style={{ background: "var(--accent-teal)", color: "#000" }}
          >
            C
          </div>
          <span className="text-base font-bold tracking-wide" style={{ color: "var(--text-primary)" }}>
            CHAINSCOPE
          </span>
        </div>

        <div className="hidden md:flex items-center gap-1">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.label}
              onClick={() => {
                if (item.comingSoon) {
                  setComingSoonMsg(item.label);
                  setTimeout(() => setComingSoonMsg(null), 2000);
                }
              }}
              className="px-3 py-1.5 rounded-md text-sm transition-colors"
              style={{
                color: item.active ? "var(--text-primary)" : "var(--text-secondary)",
                background: item.active ? "var(--bg-hover)" : "transparent",
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Right: Chain selector + Sign in + Settings */}
      <div className="flex items-center gap-3">
        {/* Chain Selector */}
        <div className="relative">
          <button
            onClick={() => setShowChainMenu(!showChainMenu)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm border"
            style={{
              borderColor: "var(--border)",
              color: "var(--text-primary)",
            }}
          >
            <span className="w-4 h-4 rounded-full" style={{ background: "linear-gradient(135deg, #9945FF, #14F195)" }} />
            Solana
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M3 5L6 8L9 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          {showChainMenu && (
            <div
              className="absolute right-0 mt-1 w-40 rounded-lg border py-1 z-50"
              style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
            >
              <div className="px-3 py-2 text-sm font-medium" style={{ color: "var(--accent-teal)" }}>
                Solana
              </div>
              {["Ethereum", "Base", "Arbitrum"].map((chain) => (
                <div key={chain} className="px-3 py-2 text-sm" style={{ color: "var(--text-muted)" }}>
                  {chain} <span className="text-xs ml-1">Coming Soon</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sign In */}
        <button
          className="hidden sm:block px-3 py-1.5 rounded-md text-sm"
          style={{ color: "var(--text-secondary)" }}
          onClick={() => {
            setComingSoonMsg("Sign In");
            setTimeout(() => setComingSoonMsg(null), 2000);
          }}
        >
          Sign in
        </button>

        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className="p-2 rounded-md transition-colors"
          style={{ color: "var(--text-secondary)" }}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        >
          {theme === "dark" ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 1a.5.5 0 01.5.5v1a.5.5 0 01-1 0v-1A.5.5 0 018 1zm0 11a.5.5 0 01.5.5v1a.5.5 0 01-1 0v-1A.5.5 0 018 12zm7-4a.5.5 0 010 1h-1a.5.5 0 010-1h1zM3 8a.5.5 0 010 1H2a.5.5 0 010-1h1zm9.354-3.354a.5.5 0 010 .708l-.708.707a.5.5 0 01-.707-.707l.707-.708a.5.5 0 01.708 0zM5.354 10.646a.5.5 0 010 .708l-.708.707a.5.5 0 01-.707-.707l.707-.708a.5.5 0 01.708 0zM12.354 11.354a.5.5 0 000-.708l-.708-.707a.5.5 0 00-.707.707l.707.708a.5.5 0 00.708 0zM5.354 5.354a.5.5 0 000-.708l-.708-.707a.5.5 0 00-.707.707l.707.708a.5.5 0 00.708 0zM8 4a4 4 0 100 8 4 4 0 000-8z"/>
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M6 .278a.768.768 0 01.08.858 7.208 7.208 0 00-.878 3.46c0 4.021 3.278 7.277 7.318 7.277.527 0 1.04-.055 1.533-.16a.787.787 0 01.81.316.733.733 0 01-.031.893A8.349 8.349 0 018.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.752.752 0 016 .278z"/>
            </svg>
          )}
        </button>
      </div>

      {/* Coming Soon Toast */}
      {comingSoonMsg && (
        <div
          className="fixed top-16 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-sm z-50 animate-fade-in"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
        >
          {comingSoonMsg} — Coming Soon
        </div>
      )}
    </nav>
  );
}
