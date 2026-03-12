export const POLLING_INTERVALS = {
  PRICES: 60_000, // 60s
  POOLS: 300_000, // 5min
  METRICS: 5_000, // 5s
  EVENTS: 5_000, // 5s
  STATS: 30_000, // 30s
  TABLE: 60_000, // 60s
} as const;

export const EVENT_TYPE_CONFIG = {
  swap: {
    label: "Swap",
    emoji: "🔄",
    color: "#6b7280",
    bgColor: "rgba(107, 114, 128, 0.15)",
  },
  whale: {
    label: "Whale",
    emoji: "🐋",
    color: "#3b82f6",
    bgColor: "rgba(59, 130, 246, 0.15)",
  },
  new_pool: {
    label: "New Pool",
    emoji: "🆕",
    color: "#22c55e",
    bgColor: "rgba(34, 197, 94, 0.15)",
  },
  liquidity: {
    label: "Liquidity",
    emoji: "💧",
    color: "#a855f7",
    bgColor: "rgba(168, 85, 247, 0.15)",
  },
  smart_money: {
    label: "Smart Money",
    emoji: "💎",
    color: "#14b8a6",
    bgColor: "rgba(20, 184, 166, 0.15)",
  },
} as const;

export const REPLAY_CADENCE = {
  swap: { min: 3_000, max: 8_000 },
  liquidity: { min: 10_000, max: 20_000 },
  new_pool: { min: 20_000, max: 40_000 },
  whale: { min: 30_000, max: 60_000 },
  smart_money: { min: 40_000, max: 90_000 },
} as const;

export const REPLAY_WEIGHTS = {
  swap: 60,
  liquidity: 15,
  new_pool: 10,
  whale: 10,
  smart_money: 5,
} as const;

export const BREAKPOINTS = {
  MOBILE: 768,
  TABLET: 1280,
} as const;

export const TOP_TOKENS_FOR_HELIUS = [
  { symbol: "BONK", address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" },
  { symbol: "WIF", address: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm" },
  { symbol: "JUP", address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN" },
  { symbol: "RAY", address: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R" },
  { symbol: "POPCAT", address: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr" },
] as const;
