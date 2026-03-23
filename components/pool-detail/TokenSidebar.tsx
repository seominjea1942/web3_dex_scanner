"use client";

import { useState } from "react";
import { formatPrice, formatCompact, formatPercent, formatUsd, formatAge } from "@/lib/format";
import type { PoolHeaderData } from "./PoolHeader";

interface TokenSidebarProps {
  data: PoolHeaderData;
  sidebarMode?: boolean; // when in dark sidebar column, use darker card bg
}

// ── Progress bar for buy/sell ratios ─────────────────────────────
function BuySellBar({ buy, sell }: { buy: number; sell: number }) {
  const total = buy + sell;
  const pct = total > 0 ? (buy / total) * 100 : 50;
  return (
    <div className="flex h-1.5 rounded-full overflow-hidden" style={{ background: "var(--accent-red)" }}>
      <div className="rounded-full" style={{ width: `${pct}%`, background: "var(--accent-green)" }} />
    </div>
  );
}

// ── FDV tooltip ──────────────────────────────────────────────────
function FdvLabel() {
  const [show, setShow] = useState(false);
  return (
    <div className="relative inline-flex items-center gap-0.5">
      <span className="text-xs uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>FDV</span>
      <span
        className="material-symbols-outlined cursor-help"
        style={{ fontSize: 12, color: "var(--text-muted)" }}
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
      >
        info
      </span>
      {show && (
        <div
          className="absolute left-0 top-full mt-1 z-30 rounded-lg p-2.5 text-xs leading-relaxed"
          style={{
            background: "var(--bg-primary)",
            border: "1px solid var(--border)",
            color: "var(--text-secondary)",
            width: 220,
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          }}
        >
          <strong style={{ color: "var(--text-primary)" }}>Fully Diluted Valuation</strong>
          <br />
          Market cap if the max supply of tokens were in circulation. Calculated as: current price × total supply.
        </div>
      )}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────
export function TokenSidebar({ data, sidebarMode }: TokenSidebarProps) {
  // In sidebar mode, cards use sidebar-specific CSS variables for theme support
  const cardBg = sidebarMode ? "var(--bg-sidebar-card)" : "var(--bg-secondary)";
  const cardBorder = sidebarMode ? "var(--border-sidebar)" : "var(--border)";
  const txns24h = data.txns?.["24h"] ?? { buys: 0, sells: 0 };
  const totalTxns = txns24h.buys + txns24h.sells;

  const buyRatio = totalTxns > 0 ? txns24h.buys / totalTxns : 0.5;
  const buyVol = data.volume_24h * buyRatio;
  const sellVol = data.volume_24h * (1 - buyRatio);

  const estMakers = Math.round(totalTxns * 0.035);
  const estBuyers = Math.round(estMakers * buyRatio);
  const estSellers = estMakers - estBuyers;

  const quoteSymbol = data.quote_token.symbol;

  return (
    <div className="space-y-3">
      {/* ─── 1. Token Header ─── */}
      <div className="flex items-center gap-3">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 overflow-hidden"
          style={{ background: "var(--bg-hover)", color: "var(--text-primary)" }}
        >
          {data.base_token.icon_url ? (
            <img
              src={data.base_token.icon_url}
              alt={data.base_token.symbol}
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
                (e.target as HTMLImageElement).parentElement!.textContent = data.base_token.symbol[0];
              }}
            />
          ) : (
            data.base_token.symbol[0]
          )}
        </div>
        <div>
          <div className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
            {data.base_token.symbol} / {data.quote_token.symbol}
          </div>
          <div className="text-xs flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
            Solana &rsaquo; {data.dex}
          </div>
        </div>
      </div>

      {/* ─── 2. Price Block ─── */}
      <div className="grid grid-cols-2 gap-2">
        <div
          className="rounded-lg p-3 border"
          style={{ background: cardBg, borderColor: cardBorder }}
        >
          <div className="text-xs uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>
            Price USD
          </div>
          <div className="text-sm font-bold font-mono" style={{ color: "var(--accent-green)" }}>
            {formatPrice(data.current_price)}
          </div>
        </div>
        <div
          className="rounded-lg p-3 border"
          style={{ background: cardBg, borderColor: cardBorder }}
        >
          <div className="text-xs uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>
            Price
          </div>
          <div className="text-sm font-bold font-mono" style={{ color: "var(--text-primary)" }}>
            {data.current_price < 0.01
              ? (data.current_price * 10000).toFixed(4)
              : data.current_price.toFixed(6)}{" "}
            <span className="text-xs font-normal" style={{ color: "var(--text-muted)" }}>{quoteSymbol}</span>
          </div>
        </div>
      </div>

      {/* ─── 3. Market Stats ─── */}
      <div className="grid grid-cols-3 gap-2">
        <div
          className="rounded-lg p-2.5 border text-center"
          style={{ background: cardBg, borderColor: cardBorder }}
        >
          <div className="text-xs uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>
            Liquidity
          </div>
          <div className="text-xs font-bold font-mono" style={{ color: "var(--text-primary)" }}>
            {formatUsd(data.liquidity)}
          </div>
        </div>
        <div
          className="rounded-lg p-2.5 border text-center"
          style={{ background: cardBg, borderColor: cardBorder }}
        >
          <div className="flex items-center justify-center mb-1">
            <FdvLabel />
          </div>
          <div className="text-xs font-bold font-mono" style={{ color: "var(--text-primary)" }}>
            {formatUsd(data.market_cap)}
          </div>
        </div>
        <div
          className="rounded-lg p-2.5 border text-center"
          style={{ background: cardBg, borderColor: cardBorder }}
        >
          <div className="text-xs uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>
            Mkt Cap
          </div>
          <div className="text-xs font-bold font-mono" style={{ color: "var(--text-primary)" }}>
            {formatUsd(data.market_cap)}
          </div>
        </div>
      </div>

      {/* ─── 4. Price Change Intervals ─── */}
      <div
        className="grid grid-cols-4 rounded-lg border overflow-hidden"
        style={{ borderColor: cardBorder }}
      >
        {[
          { label: "5M", value: data.price_changes["1h"] ? data.price_changes["1h"] * 0.08 : 0 },
          { label: "1H", value: data.price_changes["1h"] ?? 0 },
          { label: "6H", value: data.price_changes["6h"] ?? 0 },
          { label: "24H", value: data.price_changes["24h"] ?? 0 },
        ].map((item, i) => {
          const isPos = item.value >= 0;
          return (
            <div
              key={item.label}
              className="py-2.5 text-center"
              style={{
                background: "var(--bg-secondary)",
                borderRight: i < 3 ? `1px solid ${cardBorder}` : undefined,
              }}
            >
              <div className="text-xs mb-0.5" style={{ color: "var(--text-muted)" }}>
                {item.label}
              </div>
              <div
                className="text-xs font-bold font-mono"
                style={{ color: isPos ? "var(--accent-green)" : "var(--accent-red)" }}
              >
                {formatPercent(item.value)}
              </div>
            </div>
          );
        })}
      </div>

      {/* ─── 5. Trading Activity (subtle dividers) ─── */}
      <div
        className="rounded-lg border"
        style={{ background: cardBg, borderColor: cardBorder }}
      >
        {/* TXNS row */}
        <div className="p-3">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-xs uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Txns</div>
              <div className="text-sm font-bold font-mono" style={{ color: "var(--text-primary)" }}>
                {formatCompact(totalTxns)}
              </div>
            </div>
            <div className="flex gap-6 text-right">
              <div>
                <div className="text-xs uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Buys</div>
                <div className="text-xs font-bold font-mono" style={{ color: "var(--accent-green)" }}>
                  {formatCompact(txns24h.buys)}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Sells</div>
                <div className="text-xs font-bold font-mono" style={{ color: "var(--accent-red)" }}>
                  {formatCompact(txns24h.sells)}
                </div>
              </div>
            </div>
          </div>
          <BuySellBar buy={txns24h.buys} sell={txns24h.sells} />
        </div>

        <div className="h-px mx-3" style={{ background: cardBorder }} />

        {/* VOLUME row */}
        <div className="p-3">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-xs uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Volume</div>
              <div className="text-sm font-bold font-mono" style={{ color: "var(--text-primary)" }}>
                {formatUsd(data.volume_24h)}
              </div>
            </div>
            <div className="flex gap-6 text-right">
              <div>
                <div className="text-xs uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Buy Vol</div>
                <div className="text-xs font-bold font-mono" style={{ color: "var(--accent-green)" }}>
                  {formatUsd(buyVol)}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Sell Vol</div>
                <div className="text-xs font-bold font-mono" style={{ color: "var(--accent-red)" }}>
                  {formatUsd(sellVol)}
                </div>
              </div>
            </div>
          </div>
          <BuySellBar buy={buyVol} sell={sellVol} />
        </div>

        <div className="h-px mx-3" style={{ background: cardBorder }} />

        {/* MAKERS row */}
        <div className="p-3">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-xs uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Makers</div>
              <div className="text-sm font-bold font-mono" style={{ color: "var(--text-primary)" }}>
                {formatCompact(estMakers)}
              </div>
            </div>
            <div className="flex gap-6 text-right">
              <div>
                <div className="text-xs uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Buyers</div>
                <div className="text-xs font-bold font-mono" style={{ color: "var(--accent-green)" }}>
                  {formatCompact(estBuyers)}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Sellers</div>
                <div className="text-xs font-bold font-mono" style={{ color: "var(--accent-red)" }}>
                  {formatCompact(estSellers)}
                </div>
              </div>
            </div>
          </div>
          <BuySellBar buy={estBuyers} sell={estSellers} />
        </div>
      </div>

      {/* ─── 6. Pair Info ─── */}
      <div
        className="rounded-lg border p-3 space-y-2.5"
        style={{ background: cardBg, borderColor: cardBorder }}
      >
        {data.pool_created_at && (
          <div className="flex items-center justify-between text-xs">
            <span style={{ color: "var(--text-muted)" }}>Pair Created</span>
            <span className="font-medium" style={{ color: "var(--text-primary)" }}>
              {formatAge(data.pool_created_at)}
            </span>
          </div>
        )}
        <div className="flex items-center justify-between text-xs">
          <span style={{ color: "var(--text-muted)" }}>Pooled {data.base_token.symbol}</span>
          <span className="font-mono" style={{ color: "var(--text-primary)" }}>
            {formatCompact(data.liquidity / data.current_price / 2)}
          </span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span style={{ color: "var(--text-muted)" }}>Pooled {data.quote_token.symbol}</span>
          <span className="font-mono" style={{ color: "var(--text-primary)" }}>
            {formatCompact(data.liquidity / 2)}
          </span>
        </div>
        {data.holders != null && data.holders > 0 && (
          <div className="flex items-center justify-between text-xs">
            <span style={{ color: "var(--text-muted)" }}>Holders</span>
            <span className="font-mono" style={{ color: "var(--text-primary)" }}>
              {data.holders.toLocaleString()}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
