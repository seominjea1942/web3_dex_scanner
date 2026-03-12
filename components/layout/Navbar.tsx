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
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>expand_more</span>
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
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
            {theme === "dark" ? "light_mode" : "dark_mode"}
          </span>
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
