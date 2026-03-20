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
}

const RANGE_MAP: Record<string, string> = {
  "1H": "1h",
  "6H": "6h",
  "1D": "1d",
  "7D": "7d",
  "30D": "30d",
};

const FALLBACK_ORDER = ["1h", "6h", "1d", "7d", "30d"];
const TIME_RANGES = ["1H", "6H", "1D", "7D", "30D"];

export function CandlestickChart({ poolAddress, timeRange, onTimeRangeChange }: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof import("lightweight-charts").createChart> | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const [meta, setMeta] = useState<{ data_points: number; query_time_ms: number } | null>(null);
  const [ohlc, setOhlc] = useState<{ o: number; h: number; l: number; c: number; v: number } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;

    (async () => {
      // Fetch candle data — try requested range, fallback to wider if empty
      const requestedRange = RANGE_MAP[timeRange] || "1d";
      let candles: Candle[] = [];
      let queryTimeMs = 0;

      const startIdx = FALLBACK_ORDER.indexOf(requestedRange);
      for (let i = startIdx; i < FALLBACK_ORDER.length; i++) {
        if (cancelled) return;
        const r = FALLBACK_ORDER[i];
        const res = await fetch(`/api/pool/${poolAddress}/ohlcv?range=${r}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        queryTimeMs += data.query_time_ms || 0;
        candles = data.candles || [];
        if (candles.length > 0) break;
      }
      if (cancelled) return;

      setMeta({ data_points: candles.length, query_time_ms: Math.round(queryTimeMs * 100) / 100 });

      if (candles.length === 0) return;

      // Dynamically import lightweight-charts (no SSR)
      const { createChart, CandlestickSeries, HistogramSeries, CrosshairMode } = await import("lightweight-charts");
      if (cancelled || !containerRef.current) return;

      // Destroy previous chart
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }

      const chart = createChart(containerRef.current, {
        width: containerRef.current.clientWidth,
        height: 340,
        layout: {
          background: { color: "transparent" },
          textColor: "#888888",
          fontFamily: "'Moderat-Mono', 'Roboto Mono', monospace",
          fontSize: 11,
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

      chart.timeScale().fitContent();

      // Resize observer — store in ref so cleanup can disconnect it
      if (roRef.current) roRef.current.disconnect();
      const ro = new ResizeObserver((entries) => {
        if (cancelled) return;
        for (const entry of entries) {
          try {
            chart.applyOptions({ width: entry.contentRect.width });
          } catch {
            // chart may already be disposed
          }
        }
      });
      roRef.current = ro;
      ro.observe(containerRef.current);
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
  }, [poolAddress, timeRange]);

  return (
    <div>
      {/* Time range selector + LIVE + metadata bar */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        {/* Time range buttons */}
        <div className="flex items-center gap-1">
          {TIME_RANGES.map((r) => (
            <button
              key={r}
              onClick={() => onTimeRangeChange(r)}
              className="px-2.5 py-1 rounded text-xs font-medium transition-colors"
              style={{
                background: timeRange === r ? "var(--accent-blue)" : "var(--bg-hover)",
                color: timeRange === r ? "#fff" : "var(--text-muted)",
              }}
            >
              {r}
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
              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>·</span>
              <span className="text-xs font-mono font-semibold" style={{ color: "var(--accent-teal)" }}>
                {formatCompact(meta.data_points)}
              </span>
              <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>data points</span>
              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>·</span>
              <span className="text-xs font-mono font-semibold" style={{ color: "var(--accent-green)" }}>
                {meta.query_time_ms}ms
              </span>
            </>
          )}
        </div>
      </div>

      {/* OHLCV display on hover */}
      {ohlc && (
        <div className="flex items-center gap-3 mb-1 text-xs font-mono">
          <span style={{ color: "var(--text-muted)" }}>O <span style={{ color: "var(--text-primary)" }}>{ohlc.o.toFixed(8)}</span></span>
          <span style={{ color: "var(--text-muted)" }}>H <span style={{ color: "var(--accent-green)" }}>{ohlc.h.toFixed(8)}</span></span>
          <span style={{ color: "var(--text-muted)" }}>L <span style={{ color: "var(--accent-red)" }}>{ohlc.l.toFixed(8)}</span></span>
          <span style={{ color: "var(--text-muted)" }}>C <span style={{ color: "var(--text-primary)" }}>{ohlc.c.toFixed(8)}</span></span>
          <span style={{ color: "var(--text-muted)" }}>V <span style={{ color: "var(--text-secondary)" }}>${formatCompact(ohlc.v)}</span></span>
        </div>
      )}

      {/* Chart container */}
      <div
        ref={containerRef}
        className="rounded-lg overflow-hidden"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border)", minHeight: 340 }}
      />
    </div>
  );
}
