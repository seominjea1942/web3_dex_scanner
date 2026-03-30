-- Migration: schema-v2 → v2.1
-- Run these against your live TiDB Cloud database BEFORE deploying the code changes.
-- All statements are additive (no data loss). Safe to run on a live cluster.

USE chainscope;

-- 1. Fix write hotspot on swap_transactions
--    AUTO_INCREMENT puts all inserts on one TiKV region leader.
--    AUTO_RANDOM spreads them across all regions.
ALTER TABLE swap_transactions MODIFY id BIGINT AUTO_RANDOM;

-- 2. Add missing columns to tokens
ALTER TABLE tokens
  ADD COLUMN IF NOT EXISTS search_popularity INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS embedding VECTOR(1536);

-- 3. Add pool_type column and missing indexes to pools
ALTER TABLE pools
  ADD COLUMN IF NOT EXISTS pool_type VARCHAR(20) DEFAULT 'AMM',
  ADD INDEX IF NOT EXISTS idx_price_change_24h (price_change_24h DESC),
  ADD INDEX IF NOT EXISTS idx_screener_composite (volume_24h, liquidity_usd, pool_created_at);

-- 4. Add missing columns to token_safety
ALTER TABLE token_safety
  ADD COLUMN IF NOT EXISTS is_mintable  BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_freezable BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_verified  BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_lp_burned BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS risk_score   INT DEFAULT 0;

-- 5. Fix defi_events ENUM — add 'swap' type
--    Adding a new ENUM value is non-destructive; existing rows keep their values.
ALTER TABLE defi_events
  MODIFY event_type ENUM('swap', 'whale', 'large_trade', 'smart_money', 'liquidity_add', 'liquidity_remove', 'new_pool');

-- 6. Create pool_stats_live (new table — safe if already exists)
CREATE TABLE IF NOT EXISTS pool_stats_live (
  pool_address       VARCHAR(64) PRIMARY KEY,
  txn_count_24h      INT DEFAULT 0,
  unique_traders_24h INT DEFAULT 0,
  buy_sell_ratio     DECIMAL(10, 4) DEFAULT 1.0,
  updated_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 7. Create pattern_embeddings (new table — safe if already exists)
CREATE TABLE IF NOT EXISTS pattern_embeddings (
  pool_address         VARCHAR(64) PRIMARY KEY,
  token_base_address   VARCHAR(64),
  token_base_symbol    VARCHAR(32),
  token_quote_symbol   VARCHAR(32),
  pair_name            VARCHAR(64),
  dex                  VARCHAR(32),
  chain                VARCHAR(20) DEFAULT 'solana',
  embedding            VECTOR(32),
  volume_24h           DECIMAL(16, 2),
  liquidity_usd        DECIMAL(16, 2),
  market_cap           BIGINT,
  price_usd            DECIMAL(20, 10),
  price_change_1h      DECIMAL(10, 4),
  price_change_6h      DECIMAL(10, 4),
  price_change_24h     DECIMAL(10, 4),
  embedding_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_chain (chain),
  INDEX idx_volume (volume_24h DESC)
);

-- 8. Create pattern_shape_embeddings (new table — safe if already exists)
CREATE TABLE IF NOT EXISTS pattern_shape_embeddings (
  pool_address       VARCHAR(64) PRIMARY KEY,
  token_base_symbol  VARCHAR(32),
  token_quote_symbol VARCHAR(32),
  pair_name          VARCHAR(64),
  dex                VARCHAR(32),
  embedding          VECTOR(32),
  volume_24h         DECIMAL(16, 2),
  liquidity_usd      DECIMAL(16, 2),
  price_usd          DECIMAL(20, 10),
  price_change_24h   DECIMAL(10, 4),
  ohlcv_source       VARCHAR(32),
  candle_count       INT,
  updated_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_volume (volume_24h DESC)
);
