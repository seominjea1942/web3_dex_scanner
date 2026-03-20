"use client";

import { useEffect, useState } from "react";
import { formatUsd, truncateAddress } from "@/lib/format";

interface Trader {
  rank: number;
  wallet_address: string;
  volume_usd: number;
  buys: number;
  sells: number;
  label: string | null;
  last_active: string;
}

interface TopTradersProps {
  poolAddress: string;
  tokenSymbol: string;
}

const LABEL_STYLES: Record<string, { bg: string; color: string; icon: string }> = {
  whale: { bg: "rgba(99, 102, 241, 0.15)", color: "var(--accent-blue)", icon: "waves" },
  smart_money: { bg: "rgba(129, 140, 248, 0.15)", color: "var(--accent-teal)", icon: "diamond" },
  bot: { bg: "rgba(255, 141, 40, 0.15)", color: "var(--accent-orange)", icon: "smart_toy" },
  active_trader: { bg: "rgba(48, 209, 88, 0.15)", color: "var(--accent-green)", icon: "trending_up" },
};

export function TopTraders({ poolAddress, tokenSymbol }: TopTradersProps) {
  const [traders, setTraders] = useState<Trader[]>([]);

  useEffect(() => {
    const fetchTraders = () => {
      fetch(`/api/pool/${poolAddress}/top-traders?limit=7`)
        .then((r) => r.json())
        .then((data) => setTraders(data.traders || []))
        .catch(() => {});
    };
    fetchTraders();
    const iv = setInterval(fetchTraders, 30000);
    return () => clearInterval(iv);
  }, [poolAddress]);

  return (
    <div
      className="rounded-lg border overflow-hidden"
      style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
        <span className="material-symbols-outlined" style={{ fontSize: 16, color: "var(--accent-teal)" }}>group</span>
        <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Top Traders</span>
        <span
          className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
          style={{ background: "var(--bg-hover)", color: "var(--text-secondary)" }}
        >
          {tokenSymbol}
        </span>
      </div>

      <div className="overflow-auto">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ background: "var(--bg-secondary)" }}>
              {["#", "WALLET", "VOLUME", "BUYS", "SELLS", "LABEL", "ACTIVE"].map((col) => (
                <th
                  key={col}
                  className="text-left px-3 py-2 font-semibold uppercase tracking-wide whitespace-nowrap border-b"
                  style={{ color: "var(--text-muted)", borderColor: "var(--border)", fontSize: 10 }}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {traders.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center" style={{ color: "var(--text-muted)" }}>
                  Loading...
                </td>
              </tr>
            ) : traders.map((t, i) => {
              const style = t.label ? LABEL_STYLES[t.label] : null;
              return (
                <tr
                  key={t.wallet_address}
                  style={{ background: i % 2 === 0 ? "var(--bg-primary)" : "var(--bg-card)" }}
                >
                  <td className="px-3 py-2 font-mono" style={{ color: "var(--text-muted)" }}>{t.rank}</td>
                  <td className="px-3 py-2 font-mono" style={{ color: "var(--text-secondary)" }} title={t.wallet_address}>
                    {truncateAddress(t.wallet_address)}
                  </td>
                  <td className="px-3 py-2 font-mono font-medium" style={{ color: "var(--text-primary)" }}>
                    {formatUsd(t.volume_usd)}
                  </td>
                  <td className="px-3 py-2 font-mono" style={{ color: "var(--accent-green)" }}>{t.buys}</td>
                  <td className="px-3 py-2 font-mono" style={{ color: t.sells > t.buys ? "var(--accent-red)" : "var(--text-secondary)" }}>
                    {t.sells}
                  </td>
                  <td className="px-3 py-2">
                    {style && (
                      <span
                        className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded font-semibold"
                        style={{ background: style.bg, color: style.color }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 10 }}>{style.icon}</span>
                        {t.label!.replace("_", " ")}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono" style={{ color: "var(--text-muted)" }}>{t.last_active}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
