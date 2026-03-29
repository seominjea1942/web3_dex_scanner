export interface Token {
  id: string; // mint address
  symbol: string;
  name: string;
  logo_url: string | null;
  created_at: string;
}

export interface Pool {
  id: string; // pool address
  token_base_id: string;
  token_quote_id: string;
  pair_label: string;
  dex_name: string;
  pool_type: string;
  chain: string;
  price_usd: number;
  price_change_5m: number;
  price_change_1h: number;
  price_change_6h: number;
  price_change_24h: number;
  volume_1h: number;
  volume_24h: number;
  liquidity_usd: number;
  market_cap: number;
  makers: number;
  txns_24h: number;
  pool_created_at: string;
  updated_at: string;
  // joined fields
  base_logo_url?: string | null;
  base_name?: string | null;
  base_symbol?: string | null;
  quote_logo_url?: string | null;
  quote_symbol?: string | null;
}

export interface DefiEvent {
  id: number;
  event_type: "swap" | "whale" | "new_pool" | "liquidity" | "smart_money";
  token_symbol: string;
  token_logo_url: string | null;
  description: string;
  wallet_address: string;
  amount_usd: number;
  dex_name: string;
  created_at: string;
}

export interface EventTemplate {
  id: number;
  event_type: "swap" | "whale" | "new_pool" | "liquidity" | "smart_money";
  token_symbol: string;
  token_logo_url: string | null;
  description_template: string;
  wallet_address: string;
  amount_usd: number;
  dex_name: string;
  tx_hash: string;
  collected_at: string;
}

export interface PerformanceMetric {
  id: number;
  metric_type: string;
  value: number;
  recorded_at: string;
}

export interface AggregateStats {
  total_tokens: number;
  total_pools: number;
  tx_per_sec: number;
  total_rows: number;
}

export type SortField =
  | "volume_24h"
  | "liquidity_usd"
  | "price_change_24h"
  | "trending"
  | "newest";
export type SortOrder = "asc" | "desc";
export type FilterType = "hot" | "gainers" | "losers" | null;
export type EventType =
  | "swap"
  | "whale"
  | "new_pool"
  | "liquidity"
  | "smart_money";
export type TimeRange = "1H" | "6H" | "24H" | "7D";

export type ScreenerPeriod = "1h" | "24h";

export interface RangeValue {
  min?: number;
  max?: number;
}

export interface ScreenerFilters {
  age: RangeValue;       // from pool_created_at
  liquidity: RangeValue; // liquidity_usd
  period: ScreenerPeriod;
  volume: RangeValue;    // volume_1h or volume_24h
  txns: RangeValue;      // txns_24h_buys + txns_24h_sells (24h only)
  buys: RangeValue;      // txns_24h_buys (24h only)
  sells: RangeValue;     // txns_24h_sells (24h only)
}
