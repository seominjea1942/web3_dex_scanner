/**
 * GeckoTerminal OHLCV API client.
 * Free, no API key required. Rate limit: 30 req/min.
 *
 * Docs: https://www.geckoterminal.com/dex-api
 */

const BASE = "https://api.geckoterminal.com/api/v2";

export interface OHLCVCandle {
  time: number;   // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Map our app intervals to GeckoTerminal API params.
 *
 * GeckoTerminal uses:
 *   /ohlcv/minute?aggregate=N  (N = 1,5,15)
 *   /ohlcv/hour?aggregate=N    (N = 1,4,12)
 *   /ohlcv/day?aggregate=N     (N = 1)
 */
const INTERVAL_CONFIG: Record<string, { period: string; aggregate: number }> = {
  "5m":  { period: "minute", aggregate: 5 },
  "15m": { period: "minute", aggregate: 15 },
  "1H":  { period: "hour",   aggregate: 1 },
  "4H":  { period: "hour",   aggregate: 4 },
  "1D":  { period: "day",    aggregate: 1 },
};

export async function fetchOHLCV(
  poolAddress: string,
  interval: string = "15m",
  limit: number = 300,
): Promise<OHLCVCandle[]> {
  const config = INTERVAL_CONFIG[interval];
  if (!config) {
    console.warn(`Unknown interval "${interval}", falling back to 15m`);
    return fetchOHLCV(poolAddress, "15m", limit);
  }

  // GeckoTerminal caps at 1000 per request
  const fetchLimit = Math.min(limit, 1000);

  const url =
    `${BASE}/networks/solana/pools/${poolAddress}` +
    `/ohlcv/${config.period}?aggregate=${config.aggregate}&limit=${fetchLimit}` +
    `&currency=usd`;

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: 0 },
    });

    if (!res.ok) {
      console.warn(`GeckoTerminal OHLCV ${res.status}: ${url}`);
      return [];
    }

    const json = await res.json();
    const list: number[][] = json?.data?.attributes?.ohlcv_list ?? [];

    // GeckoTerminal returns [timestamp, open, high, low, close, volume]
    // Sorted newest-first — we reverse to oldest-first for the chart
    return list
      .map(([ts, o, h, l, c, v]) => ({
        time: ts,
        open: o,
        high: h,
        low: l,
        close: c,
        volume: v,
      }))
      .reverse();
  } catch (err) {
    console.error("GeckoTerminal OHLCV fetch error:", err);
    return [];
  }
}
