"use client";

import { useEffect, useRef, useState } from "react";
import { formatCompact } from "@/lib/format";

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface CandlestickChartProps {
  poolAddress: string;
  timeRange: string;
  onTimeRangeChange: (range: string) => void;
  mobileFullHeight?: boolean;
}

// Candle intervals — each button = candle size (like DEXScreener)
const INTERVALS: { label: string; value: string }[] = [
  { label: "5m", value: "5m" },
  { label: "15m", value: "15m" },
  { label: "1H", value: "1h" },
  { label: "4H", value: "4h" },
  { label: "1D", value: "1d" },
];

const INTERVAL_MAP: Record<string, string> = Object.fromEntries(
  INTERVALS.map((i) => [i.label, i.value])
);

// Fallback: try wider intervals if current one has no data
const FALLBACK_ORDER = ["5m", "15m", "1h", "4h", "1d"];

export function CandlestickChart({ poolAddress, timeRange, onTimeRangeChange, mobileFullHeight }: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof import("lightweight-charts").createChart> | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const [meta, setMeta] = useState<{ data_points: number; query_time_ms: number } | null>(null);
  const [ohlc, setOhlc] = useState<{ o: number; h: number; l: number; c: number; v: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        // Fetch candle data — interval = candle size
        const requestedInterval = INTERVAL_MAP[timeRange] || "15m";
        let candles: Candle[] = [];
        let queryTimeMs = 0;

        const startIdx = FALLBACK_ORDER.indexOf(requestedInterval);
        for (let i = startIdx; i < FALLBACK_ORDER.length; i++) {
          if (cancelled) return;
          const intv = FALLBACK_ORDER[i];
          const res = await fetch(`/api/pool/${poolAddress}/ohlcv?interval=${intv}`);
          if (cancelled) return;
          if (!res.ok) {
            throw new Error(`API returned ${res.status}`);
          }
          const data = await res.json();
          queryTimeMs += data.query_time_ms || 0;
          candles = data.candles || [];
          if (candles.length > 0) break;
        }
        if (cancelled) return;

        setMeta({ data_points: candles.length, query_time_ms: Math.round(queryTimeMs * 100) / 100 });
        setLoading(false);

        if (candles.length === 0) return;

        // Dynamically import lightweight-charts (no SSR)
        const { createChart, CandlestickSeries, HistogramSeries, CrosshairMode } = await import("lightweight-charts");
        if (cancelled || !containerRef.current) return;

        // Destroy previous chart
        if (chartRef.current) {
          chartRef.current.remove();
          chartRef.current = null;
        }

        const chartHeight = mobileFullHeight ? containerRef.current.clientHeight || 500 : 340;
        const chart = createChart(containerRef.current, {
          width: containerRef.current.clientWidth,
          height: chartHeight,
          layout: {
            background: { color: "transparent" },
            textColor: "#888888",
            fontFamily: "'Moderat-Mono', 'Roboto Mono', monospace",
            fontSize: 12,
          },
          grid: {
            vertLines: { color: "rgba(255,255,255,0.04)" },
            horzLines: { color: "rgba(255,255,255,0.04)" },
          },
          crosshair: { mode: CrosshairMode.Normal },
          rightPriceScale: {
            borderColor: "rgba(255,255,255,0.1)",
          },
          timeScale: {
            borderColor: "rgba(255,255,255,0.1)",
            timeVisible: true,
            secondsVisible: false,
          },
        });
        chartRef.current = chart;

        // Candlestick series
        const candleSeries = chart.addSeries(CandlestickSeries, {
          upColor: "#30D158",
          downColor: "#FF4259",
          borderUpColor: "#30D158",
          borderDownColor: "#FF4259",
          wickUpColor: "#30D158",
          wickDownColor: "#FF4259",
        });

        const candleData = candles.map((c) => ({
          time: c.time as import("lightweight-charts").UTCTimestamp,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }));
        candleSeries.setData(candleData);

        // Volume series
        const volumeSeries = chart.addSeries(HistogramSeries, {
          priceFormat: { type: "volume" as const },
          priceScaleId: "volume",
        });
        chart.priceScale("volume").applyOptions({
          scaleMargins: { top: 0.85, bottom: 0 },
        });

        const volumeData = candles.map((c) => ({
          time: c.time as import("lightweight-charts").UTCTimestamp,
          value: c.volume,
          color: c.close >= c.open ? "rgba(48, 209, 88, 0.2)" : "rgba(255, 66, 89, 0.2)",
        }));
        volumeSeries.setData(volumeData);

        // Crosshair move → update OHLCV display
        chart.subscribeCrosshairMove((param) => {
          if (!param.time || !param.seriesData) {
            setOhlc(null);
            return;
          }
          const d = param.seriesData.get(candleSeries) as { open: number; high: number; low: number; close: number } | undefined;
          const v = param.seriesData.get(volumeSeries) as { value: number } | undefined;
          if (d) {
            setOhlc({ o: d.open, h: d.high, l: d.low, c: d.close, v: v?.value ?? 0 });
          }
        });

        // Show only the last ~80 candles in the initial viewport
        // Users can scroll/pan left to see older data
        const VISIBLE_CANDLES = 80;
        const totalBars = candleData.length;
        if (totalBars > VISIBLE_CANDLES) {
          chart.timeScale().setVisibleLogicalRange({
            from: totalBars - VISIBLE_CANDLES,
            to: totalBars + 5, // small right padding
          });
        } else {
          chart.timeScale().fitContent();
        }

        // Resize observer — store in ref so cleanup can disconnect it
        if (roRef.current) roRef.current.disconnect();
        const ro = new ResizeObserver((entries) => {
          if (cancelled) return;
          for (const entry of entries) {
            try {
              chart.applyOptions({ width: entry.contentRect.width });
            } catch (_e) {
              // chart may already be disposed
            }
          }
        });
        roRef.current = ro;
        ro.observe(containerRef.current);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load chart data");
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (roRef.current) {
        roRef.current.disconnect();
        roRef.current = null;
      }
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [poolAddress, timeRange, mobileFullHeight]);

  return (
    <div className={mobileFullHeight ? "flex flex-col flex-1 min-h-0" : ""}>
      {/* Time range selector + LIVE + metadata bar */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        {/* Interval buttons — each = candle size */}
        <div className="flex items-center gap-1">
          {INTERVALS.map((i) => (
            <button
              key={i.label}
              onClick={() => onTimeRangeChange(i.label)}
              className="px-3.5 py-1.5 rounded text-sm font-medium transition-colors"
              style={{
                background: timeRange === i.label ? "var(--accent-blue)" : "var(--bg-hover)",
                color: timeRange === i.label ? "#fff" : "var(--text-muted)",
              }}
            >
              {i.label}
            </button>
          ))}
        </div>

        {/* LIVE + data points — emphasized */}
        <div
          className="flex items-center gap-2.5 ml-auto px-3 py-1.5 rounded-lg"
          style={{ background: "rgba(48, 209, 88, 0.08)", border: "1px solid rgba(48, 209, 88, 0.2)" }}
        >
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: "var(--accent-green)", animation: "pulse-dot 2s ease-in-out infinite" }}
          />
          <span className="text-xs font-semibold" style={{ color: "var(--accent-green)" }}>LIVE</span>
          {meta && (
            <>
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>·</span>
              <span className="text-xs font-mono font-semibold" style={{ color: "var(--accent-teal)" }}>
                {formatCompact(meta.data_points)}
              </span>
              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>data points</span>
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>·</span>
              <span className="text-xs font-mono font-semibold" style={{ color: "var(--accent-green)" }}>
                {meta.query_time_ms}ms
              </span>
            </>
          )}
        </div>
      </div>

      {/* Chart container with OHLCV overlay */}
      <div className={`relative ${mobileFullHeight ? "flex-1 min-h-0" : ""}`}>
        <div
          ref={containerRef}
          className={`rounded-lg overflow-hidden ${mobileFullHeight ? "h-full" : ""}`}
          style={{ background: "var(--bg-sidebar)", border: "1px solid var(--border)", minHeight: mobileFullHeight ? undefined : 340 }}
        />

        {/* Loading state */}
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-lg" style={{ background: "var(--bg-sidebar)", border: "1px solid var(--border)" }}>
            <div className="w-6 h-6 border-2 rounded-full animate-spin" style={{ borderColor: "var(--border)", borderTopColor: "var(--accent-teal)" }} />
            <span className="text-sm" style={{ color: "var(--text-muted)" }}>Loading chart data...</span>
          </div>
        )}

        {/* Error state */}
        {!loading && error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg" style={{ background: "var(--bg-sidebar)", border: "1px solid var(--border)" }}>
            <span className="material-symbols-outlined" style={{ fontSize: 28, color: "var(--accent-red)" }}>error</span>
            <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{error}</span>
            <button
              onClick={() => onTimeRangeChange(timeRange)}
              className="mt-1 px-3 py-1 rounded text-xs font-medium"
              style={{ background: "var(--bg-hover)", color: "var(--text-primary)" }}
            >
              Retry
            </button>
          </div>
        )}

        {/* No data state */}
        {!loading && !error && meta && meta.data_points === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg" style={{ background: "var(--bg-sidebar)", border: "1px solid var(--border)" }}>
            <span className="material-symbols-outlined" style={{ fontSize: 28, color: "var(--text-muted)" }}>show_chart</span>
            <span className="text-sm" style={{ color: "var(--text-muted)" }}>No chart data available for this pool</span>
          </div>
        )}
        {/* OHLCV overlay inside chart */}
        <div
          className="absolute top-2 left-3 flex items-center gap-3 text-xs font-mono z-10 pointer-events-none"
          style={{ visibility: ohlc ? "visible" : "hidden" }}
        >
          <span style={{ color: "var(--text-muted)" }}>O <span style={{ color: "var(--text-primary)" }}>{ohlc?.o.toFixed(8)}</span></span>
          <span style={{ color: "var(--text-muted)" }}>H <span style={{ color: "var(--accent-green)" }}>{ohlc?.h.toFixed(8)}</span></span>
          <span style={{ color: "var(--text-muted)" }}>L <span style={{ color: "var(--accent-red)" }}>{ohlc?.l.toFixed(8)}</span></span>
          <span style={{ color: "var(--text-muted)" }}>C <span style={{ color: "var(--text-primary)" }}>{ohlc?.c.toFixed(8)}</span></span>
          <span style={{ color: "var(--text-muted)" }}>V <span style={{ color: "var(--text-secondary)" }}>${formatCompact(ohlc?.v ?? 0)}</span></span>
        </div>
      </div>
    </div>
  );
}
