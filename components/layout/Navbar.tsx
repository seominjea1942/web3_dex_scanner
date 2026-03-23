"use client";

import { useState } from "react";
import { useTheme } from "@/app/providers";

interface NavbarProps {
  activePage?: string;
  onNavigate?: (page: string) => void;
}

const NAV_ITEMS = [
  { label: "DEX Screener", page: "screener" },
  { label: "SQL Console", page: "sql-console" },
];

export function Navbar({ activePage = "screener", onNavigate }: NavbarProps) {
  const { theme, toggleTheme } = useTheme();
  const [showChainMenu, setShowChainMenu] = useState(false);
  const [comingSoonMsg, setComingSoonMsg] = useState<string | null>(null);

  return (
    <div className="z-50" style={{ background: "var(--bg-secondary)" }}>
      <nav
        className="flex items-center justify-between px-4 border-b"
        style={{
          borderColor: "var(--border)",
          height: 54,
        }}
      >
      {/* Left: Logo + Nav */}
      <div className="flex items-center gap-6 self-stretch">
        <svg width="140" height="48" viewBox="0 0 140 48" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-12 w-auto cursor-pointer" onClick={() => onNavigate?.("screener")}>
          <g clipPath="url(#clip0_163_8014)">
            <path d="M5.83667 30.2224V17.7843C5.83667 17.7582 5.84969 17.7387 5.86923 17.7257L16.6338 11.5066C16.6533 11.4936 16.6793 11.4936 16.6989 11.5066L27.4634 17.7192C27.4829 17.7322 27.496 17.7517 27.496 17.7778V30.2159C27.496 30.2419 27.4829 30.2615 27.4634 30.2745L16.6989 36.4936C16.6793 36.5066 16.6533 36.5066 16.6338 36.4936L5.86923 30.2745C5.84969 30.2615 5.83667 30.2419 5.83667 30.2224Z" fill="var(--text-primary)" />
            <path d="M13.0454 21.9399C13.0389 21.9334 13.0258 21.9269 13.0193 21.9334L9.48324 23.9782H9.47022C9.4572 23.9782 9.45068 23.9717 9.45068 23.9587V19.8365C9.45068 19.83 9.45719 19.8235 9.46371 19.817L16.6401 15.6753C16.6466 15.6688 16.6531 15.6688 16.6596 15.6753L20.2282 17.7331L20.2347 17.7396C20.2413 17.7461 20.2347 17.7592 20.2282 17.7657L16.6531 19.83C16.6466 19.8365 16.6401 19.843 16.6401 19.8496V32.3072V32.3203C16.6335 32.3268 16.6205 32.3333 16.614 32.3268L13.0519 30.2755C13.0519 30.2689 13.0454 30.2624 13.0454 30.2559V21.953V21.9399Z" fill="var(--bg-secondary)" />
            <path d="M20.2803 30.2494C20.2673 30.2494 20.2543 30.2364 20.2543 30.2234V21.9399C20.2543 21.9269 20.2608 21.9204 20.2673 21.9139L23.8425 19.8496C23.849 19.843 23.849 19.843 23.8555 19.843C23.8685 19.843 23.8815 19.8561 23.8815 19.8691V28.1525C23.8815 28.1655 23.875 28.172 23.8685 28.1786L20.2933 30.2429C20.2868 30.2494 20.2868 30.2494 20.2803 30.2494Z" fill="var(--bg-secondary)" />
          </g>
          <path d="M42.0667 29.692C38.7867 29.692 36.5147 27.276 36.5147 23.916C36.5147 20.572 38.8347 18.108 42.0667 18.108C44.6907 18.108 46.8187 19.692 47.1547 21.996H44.8187C44.4347 20.812 43.4107 20.14 42.0667 20.14C40.0987 20.14 38.8027 21.628 38.8027 23.9C38.8027 26.076 40.0187 27.66 42.0667 27.66C43.3787 27.66 44.4507 27.02 44.8187 25.804H47.1707C46.8347 28.124 44.7067 29.692 42.0667 29.692ZM55.7757 29.5V24.828H51.2317V29.5H48.9917V18.3H51.2317V22.844H55.7757V18.3H57.9997V29.5H55.7757ZM59.5686 29.5L63.4246 18.3H66.3366L70.1766 29.5H67.8406L66.9926 26.924H62.7686L61.9206 29.5H59.5686ZM63.3926 25.068H66.3686L64.9286 20.748H64.8326L63.3926 25.068ZM71.3299 29.5V21.436H73.4739V29.5H71.3299ZM72.4179 20.588C71.6819 20.588 71.0899 20.012 71.0899 19.26C71.0899 18.524 71.6819 17.948 72.4179 17.948C73.1379 17.948 73.7299 18.524 73.7299 19.26C73.7299 20.012 73.1379 20.588 72.4179 20.588ZM75.398 29.5V18.3H77.638L82.342 25.676H82.438V18.3H84.534V29.5H82.31L77.606 22.124H77.51V29.5H75.398ZM90.4999 29.692C88.0679 29.692 86.3559 28.316 86.2919 26.188H88.6759C88.8199 27.196 89.4919 27.74 90.5319 27.74C91.4439 27.74 92.2279 27.308 92.2279 26.492C92.2279 25.836 91.7639 25.34 90.7559 25.02L89.2999 24.588C87.5399 24.044 86.5959 22.924 86.5959 21.42C86.5959 19.452 88.1799 18.108 90.3719 18.108C92.5799 18.108 94.2599 19.516 94.2919 21.356H91.9079C91.8279 20.588 91.1719 20.06 90.3239 20.06C89.5239 20.06 88.8839 20.556 88.8839 21.276C88.8839 21.868 89.3159 22.268 90.3879 22.604L91.6359 22.988C93.5559 23.58 94.5159 24.812 94.5159 26.38C94.5159 28.46 92.8039 29.692 90.4999 29.692ZM101.457 29.692C98.1774 29.692 95.9054 27.276 95.9054 23.916C95.9054 20.572 98.2254 18.108 101.457 18.108C104.081 18.108 106.209 19.692 106.545 21.996H104.209C103.825 20.812 102.801 20.14 101.457 20.14C99.4894 20.14 98.1934 21.628 98.1934 23.9C98.1934 26.076 99.4094 27.66 101.457 27.66C102.769 27.66 103.841 27.02 104.209 25.804H106.561C106.225 28.124 104.097 29.692 101.457 29.692ZM113.807 29.692C110.447 29.692 107.999 27.26 107.999 23.9C107.999 20.54 110.447 18.108 113.807 18.108C117.167 18.108 119.615 20.54 119.615 23.9C119.615 27.26 117.167 29.692 113.807 29.692ZM113.807 27.66C115.871 27.66 117.327 26.108 117.327 23.9C117.327 21.692 115.871 20.14 113.807 20.14C111.743 20.14 110.287 21.692 110.287 23.9C110.287 26.108 111.743 27.66 113.807 27.66ZM121.539 29.5V18.3H126.051C128.259 18.3 129.811 19.772 129.811 21.868C129.811 23.98 128.259 25.452 126.051 25.452H123.779V29.5H121.539ZM123.779 23.548H125.779C126.819 23.548 127.523 22.876 127.523 21.884C127.523 20.876 126.819 20.204 125.779 20.204H123.779V23.548ZM131.554 29.5V18.3H138.93V20.252H133.794V22.876H138.178V24.828H133.794V27.548H138.93V29.5H131.554Z" fill="var(--text-primary)" />
          <defs>
            <clipPath id="clip0_163_8014">
              <rect width="21.6593" height="25" fill="white" transform="translate(5.83691 11.5)" />
            </clipPath>
          </defs>
        </svg>

        <div className="hidden md:flex items-stretch gap-6 self-stretch">
          {NAV_ITEMS.map((item) => {
            const isActive = activePage === item.page;
            return (
              <button
                key={item.label}
                onClick={() => onNavigate?.(item.page)}
                className="relative px-1 text-sm font-medium transition-colors flex items-center"
                style={{
                  color: isActive ? "var(--text-primary)" : "var(--text-muted)",
                }}
              >
                {item.label}
                {isActive && (
                  <span
                    className="absolute left-0 right-0 h-0.5"
                    style={{ background: "var(--accent-blue, #6366F1)", bottom: 0 }}
                  />
                )}
              </button>
            );
          })}
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
            <img src="https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png" alt="Solana" className="w-5 h-5 rounded-full" />
            Solana
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>expand_more</span>
          </button>
          {showChainMenu && (
            <div
              className="fixed sm:absolute right-2 sm:right-0 mt-1 rounded-lg border py-1 z-50 whitespace-nowrap w-[calc(100vw-16px)] sm:w-auto max-w-[280px]"
              style={{ background: "var(--bg-card)", borderColor: "var(--border)", boxShadow: "0 8px 24px rgba(0,0,0,0.3)" }}
            >
              {/* Solana — active */}
              <div
                className="chain-menu-item flex items-center gap-2 px-3 py-2 text-sm font-medium cursor-pointer"
                style={{ color: "var(--accent-teal)" }}
              >
                <img src="https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png" alt="Solana" className="w-5 h-5 rounded-full shrink-0" />
                Solana
              </div>
              {/* Coming soon chains */}
              {([
                { name: "Ethereum", logo: "https://assets.coingecko.com/coins/images/279/small/ethereum.png" },
                { name: "Base", logo: "https://assets.coingecko.com/asset_platforms/images/131/small/base-network.png" },
                { name: "Arbitrum", logo: "https://assets.coingecko.com/coins/images/16547/small/photo_2023-03-29_21.47.00.jpeg" },
              ] as const).map((chain) => (
                <div
                  key={chain.name}
                  className="chain-menu-item flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer whitespace-nowrap"
                >
                  <img src={chain.logo} alt={chain.name} className="w-5 h-5 rounded-full shrink-0" />
                  <span className="shrink-0" style={{ color: "var(--text-primary)" }}>{chain.name}</span>
                  <span className="text-xs shrink-0 ml-auto pl-3" style={{ color: "var(--text-muted)" }}>Coming Soon</span>
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
          className="w-9 h-9 flex items-center justify-center rounded-md transition-colors"
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

    {/* Mobile tab bar — second row */}
    <div
      className="flex md:hidden items-stretch border-b"
      style={{ borderColor: "var(--border)", height: 40 }}
    >
      {NAV_ITEMS.map((item) => {
        const isActive = activePage === item.page;
        return (
          <button
            key={item.label}
            onClick={() => onNavigate?.(item.page)}
            className="relative flex-1 text-xs font-medium transition-colors flex items-center justify-center"
            style={{
              color: isActive ? "var(--text-primary)" : "var(--text-muted)",
            }}
          >
            {item.label}
            {isActive && (
              <span
                className="absolute left-0 right-0 h-0.5"
                style={{ background: "var(--accent-blue, #6366F1)", bottom: 0 }}
              />
            )}
          </button>
        );
      })}
    </div>
    </div>
  );
}
