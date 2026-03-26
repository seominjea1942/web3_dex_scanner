/**
 * Pattern Embedding — converts pool multi-timeframe metrics into a 32-dim vector.
 *
 * Since we don't have OHLCV candle history, we embed the pool's "market profile":
 *   - Volume profile across timeframes (normalized)
 *   - Price change profile across timeframes
 *   - Transaction buy/sell ratios across timeframes
 *   - Liquidity & market cap features
 *
 * Two pools with similar embeddings have similar market behavior patterns:
 *   similar volume distribution, similar momentum, similar trading pressure.
 */

export interface PoolMetrics {
  volume_5m: number;
  volume_1h: number;
  volume_6h: number;
  volume_24h: number;
  price_change_5m: number;
  price_change_1h: number;
  price_change_6h: number;
  price_change_24h: number;
  txns_5m_buys: number;
  txns_5m_sells: number;
  txns_1h_buys: number;
  txns_1h_sells: number;
  txns_24h_buys: number;
  txns_24h_sells: number;
  liquidity_usd: number;
  market_cap: number;
  price_usd: number;
}

/**
 * Generate a 32-dimensional embedding from pool metrics.
 * The vector captures the pool's "market behavior fingerprint".
 */
export function generatePatternEmbedding(m: PoolMetrics): number[] {
  const v24 = Math.max(m.volume_24h, 1);

  // --- Volume distribution (4 dims) ---
  // How volume is distributed across timeframes (sums to ~1)
  const volTotal = Math.max(m.volume_5m + m.volume_1h + m.volume_6h + m.volume_24h, 1);
  const volDist = [
    m.volume_5m / volTotal,
    m.volume_1h / volTotal,
    m.volume_6h / volTotal,
    m.volume_24h / volTotal,
  ];

  // --- Volume momentum (3 dims) ---
  // Ratios between timeframes showing acceleration/deceleration
  const volMom = [
    m.volume_1h > 0 ? Math.min(m.volume_5m * 12 / m.volume_1h, 5) / 5 : 0.5, // 5m rate vs 1h rate
    m.volume_6h > 0 ? Math.min(m.volume_1h * 6 / m.volume_6h, 5) / 5 : 0.5,  // 1h rate vs 6h rate
    v24 > 0 ? Math.min(m.volume_6h * 4 / v24, 5) / 5 : 0.5,                   // 6h rate vs 24h rate
  ];

  // --- Price change profile (4 dims) ---
  // Normalized price changes (sigmoid-like compression)
  const sigmoid = (x: number, scale: number) => 1 / (1 + Math.exp(-x / scale));
  const priceProfile = [
    sigmoid(m.price_change_5m, 2),
    sigmoid(m.price_change_1h, 5),
    sigmoid(m.price_change_6h, 10),
    sigmoid(m.price_change_24h, 20),
  ];

  // --- Price momentum (3 dims) ---
  // Relative change between timeframes
  const priceMom = [
    sigmoid(m.price_change_5m - m.price_change_1h / 12, 1),  // short-term acceleration
    sigmoid(m.price_change_1h - m.price_change_6h / 6, 2),   // mid-term acceleration
    sigmoid(m.price_change_6h - m.price_change_24h / 4, 5),  // longer-term acceleration
  ];

  // --- Buy/sell pressure (6 dims) ---
  const buyRatio = (buys: number, sells: number) => {
    const total = buys + sells;
    return total === 0 ? 0.5 : buys / total;
  };
  const txnPressure = [
    buyRatio(m.txns_5m_buys, m.txns_5m_sells),
    buyRatio(m.txns_1h_buys, m.txns_1h_sells),
    buyRatio(m.txns_24h_buys, m.txns_24h_sells),
  ];

  // Transaction intensity (buys+sells per timeframe, log-normalized)
  const logNorm = (x: number, scale: number) => Math.min(Math.log10(Math.max(x, 1)) / scale, 1);
  const txnIntensity = [
    logNorm(m.txns_5m_buys + m.txns_5m_sells, 4),    // 0-10000 txns
    logNorm(m.txns_1h_buys + m.txns_1h_sells, 5),     // 0-100000 txns
    logNorm(m.txns_24h_buys + m.txns_24h_sells, 6),   // 0-1000000 txns
  ];

  // --- Liquidity features (4 dims) ---
  const liqFeatures = [
    logNorm(m.liquidity_usd, 9),                               // absolute liquidity (log scale)
    logNorm(m.market_cap, 12),                                 // market cap (log scale)
    m.liquidity_usd > 0 ? Math.min(v24 / m.liquidity_usd, 10) / 10 : 0, // volume/liquidity ratio
    logNorm(m.price_usd, 6),                                   // price level (log scale)
  ];

  // --- Volatility proxy (3 dims) ---
  const volat = [
    Math.min(Math.abs(m.price_change_5m) + Math.abs(m.price_change_1h), 50) / 50,   // short volatility
    Math.min(Math.abs(m.price_change_6h) + Math.abs(m.price_change_24h), 100) / 100, // long volatility
    // Change direction consistency: all same direction = 1, mixed = 0
    (() => {
      const signs = [m.price_change_5m, m.price_change_1h, m.price_change_6h, m.price_change_24h]
        .map(x => x >= 0 ? 1 : -1);
      const sum = Math.abs(signs.reduce((a, b) => a + b, 0));
      return sum / 4; // 4 = all same direction, 0 = split
    })(),
  ];

  // --- Trade size profile (2 dims) ---
  const txns5m = m.txns_5m_buys + m.txns_5m_sells;
  const txns24h = m.txns_24h_buys + m.txns_24h_sells;
  const tradeSize = [
    txns5m > 0 ? Math.min(m.volume_5m / txns5m, 100000) / 100000 : 0,    // avg trade size (5m)
    txns24h > 0 ? Math.min(v24 / txns24h, 100000) / 100000 : 0,          // avg trade size (24h)
  ];

  // Concatenate all segments → 32 dims
  const embedding = [
    ...volDist,       // 4
    ...volMom,        // 3
    ...priceProfile,  // 4
    ...priceMom,      // 3
    ...txnPressure,   // 3
    ...txnIntensity,  // 3
    ...liqFeatures,   // 4
    ...volat,         // 3
    ...tradeSize,     // 2
    // padding to 32
    sigmoid(m.price_change_24h, 10), // overall trend indicator
    Math.min(v24 / 1e6, 1),          // volume scale (0-1M = 0-1)
    logNorm(txns24h, 5),              // activity level
  ]; // = 32

  // L2 normalize
  const norm = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0));
  if (norm < 1e-10) return embedding;
  return embedding.map(v => v / norm);
}

/**
 * Decompose similarity into interpretable categories for UI display.
 */
export function decomposeSimilarity(
  vecA: number[],
  vecB: number[]
): { volume: number; momentum: number; pressure: number; overall: number } {
  const cosine = (a: number[], b: number[]) => {
    const dot = a.reduce((s, v, i) => s + v * b[i], 0);
    const na = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
    const nb = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
    return na === 0 || nb === 0 ? 0 : dot / (na * nb);
  };

  return {
    volume: cosine(vecA.slice(0, 7), vecB.slice(0, 7)),       // volume dist + momentum
    momentum: cosine(vecA.slice(7, 14), vecB.slice(7, 14)),    // price profile + momentum
    pressure: cosine(vecA.slice(14, 20), vecB.slice(14, 20)),  // buy/sell pressure + intensity
    overall: cosine(vecA, vecB),
  };
}
