export const POLLING_INTERVALS = {
  PRICES: 60_000, // 60s
  POOLS: 300_000, // 5min
  METRICS: 15_000, // 15s (was 5s)
  EVENTS: 10_000, // 10s (was 5s)
  STATS: 60_000, // 60s (was 30s)
  TABLE: 30_000, // 30s (was 10s)
} as const;

export const EVENT_TYPE_CONFIG = {
  swap: {
    label: "Swap",
    icon: "swap_horiz",
    img: "/icons/swap.png",
    color: "#888888",
    bgColor: "rgba(136, 136, 136, 0.15)",
  },
  whale: {
    label: "Whale",
    icon: "waves",
    img: "/icons/whale.png",
    color: "#0091FF",
    bgColor: "rgba(0, 145, 255, 0.15)",
  },
  new_pool: {
    label: "New Pool",
    icon: "add_circle",
    img: "/icons/new_pool.png",
    color: "#30D158",
    bgColor: "rgba(48, 209, 88, 0.15)",
  },
  liquidity: {
    label: "Liquidity",
    icon: "water_drop",
    img: "/icons/liquidity.png",
    color: "#DB34F2",
    bgColor: "rgba(219, 52, 242, 0.15)",
  },
  liquidity_add: {
    label: "Liquidity",
    icon: "water_drop",
    img: "/icons/liquidity.png",
    color: "#DB34F2",
    bgColor: "rgba(219, 52, 242, 0.15)",
  },
  liquidity_remove: {
    label: "Liquidity",
    icon: "water_drop",
    img: "/icons/liquidity.png",
    color: "#DB34F2",
    bgColor: "rgba(219, 52, 242, 0.15)",
  },
  large_trade: {
    label: "Swap",
    icon: "swap_horiz",
    img: "/icons/swap.png",
    color: "#888888",
    bgColor: "rgba(136, 136, 136, 0.15)",
  },
  smart_money: {
    label: "Smart Money",
    icon: "diamond",
    img: "/icons/smart_money.png",
    color: "#3CD3FE",
    bgColor: "rgba(60, 211, 254, 0.15)",
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
