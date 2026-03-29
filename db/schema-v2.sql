-- CHAINSCOPE v2 Schema — Use Case Driven Data
-- Target: Instance B (local TiDB or new TiDB Cloud cluster)

CREATE DATABASE IF NOT EXISTS chainscope;
USE chainscope;

-- Token metadata (real data from Jupiter + DexScreener)
CREATE TABLE IF NOT EXISTS tokens (
  address VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128),
  symbol VARCHAR(32),
  decimals INT,
  logo_url VARCHAR(256),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FULLTEXT INDEX idx_tokens_name_ft (name) WITH PARSER STANDARD
);

-- Pool data (real data from DexScreener)
CREATE TABLE IF NOT EXISTS pools (
  address VARCHAR(64) PRIMARY KEY,
  token_base_address VARCHAR(64),
  token_quote_address VARCHAR(64),
  token_base_symbol VARCHAR(32),
  token_quote_symbol VARCHAR(32),
  dex VARCHAR(32),
  price_usd DECIMAL(20, 10),
  volume_5m DECIMAL(16, 2),
  volume_1h DECIMAL(16, 2),
  volume_6h DECIMAL(16, 2),
  volume_24h DECIMAL(16, 2),
  liquidity_usd DECIMAL(16, 2),
  market_cap BIGINT,
  txns_5m_buys INT,
  txns_5m_sells INT,
  txns_1h_buys INT,
  txns_1h_sells INT,
  txns_24h_buys INT,
  txns_24h_sells INT,
  price_change_5m DECIMAL(10, 4),
  price_change_1h DECIMAL(10, 4),
  price_change_6h DECIMAL(10, 4),
  price_change_24h DECIMAL(10, 4),
  pool_created_at BIGINT,
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_volume24h (volume_24h DESC),
  INDEX idx_liquidity (liquidity_usd DESC),
  INDEX idx_created (pool_created_at DESC),
  INDEX idx_dex (dex),
  INDEX idx_base_token (token_base_address),
  INDEX idx_price_change (price_change_5m DESC),
  FULLTEXT INDEX idx_pools_symbol_ft (token_base_symbol) WITH PARSER STANDARD
);

-- Pool snapshots (collected over time from DexScreener)
CREATE TABLE IF NOT EXISTS pool_snapshots (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  pool_address VARCHAR(64),
  snapshot_time TIMESTAMP,
  price_usd DECIMAL(20, 10),
  volume_5m DECIMAL(16, 2),
  volume_1h DECIMAL(16, 2),
  volume_24h DECIMAL(16, 2),
  liquidity_usd DECIMAL(16, 2),
  txns_5m INT,
  txns_1h INT,
  INDEX idx_pool_time (pool_address, snapshot_time),
  INDEX idx_time (snapshot_time)
);

-- Swap transactions (generated, constrained by real pool volumes)
CREATE TABLE IF NOT EXISTS swap_transactions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  signature VARCHAR(128),
  timestamp BIGINT NOT NULL,
  pool_address VARCHAR(64) NOT NULL,
  dex VARCHAR(32) NOT NULL,
  side ENUM('buy', 'sell') NOT NULL,
  base_amount DECIMAL(20, 6),
  quote_amount DECIMAL(20, 2),
  usd_value DECIMAL(16, 2),
  trader_wallet VARCHAR(64),
  INDEX idx_timestamp (timestamp),
  INDEX idx_pool_ts (pool_address, timestamp),
  INDEX idx_wallet (trader_wallet),
  INDEX idx_usd (usd_value DESC),
  INDEX idx_dex_ts (dex, timestamp),
  INDEX idx_side_pool (side, pool_address, timestamp)
);

-- Wallet profiles (generated with behavior patterns)
CREATE TABLE IF NOT EXISTS wallet_profiles (
  address VARCHAR(64) PRIMARY KEY,
  label ENUM('whale', 'smart_money', 'active_trader', 'bot', 'retail'),
  total_volume DECIMAL(20, 2),
  trade_count INT,
  buy_count INT,
  sell_count INT,
  pools_traded INT,
  avg_trade_size DECIMAL(16, 2),
  first_seen BIGINT,
  last_seen BIGINT,
  INDEX idx_label (label),
  INDEX idx_volume (total_volume DESC)
);

-- Token safety data (generated, correlated with real market cap)
CREATE TABLE IF NOT EXISTS token_safety (
  token_address VARCHAR(64) PRIMARY KEY,
  holder_count INT,
  top10_holder_pct DECIMAL(5, 2),
  lp_locked BOOLEAN,
  is_suspicious BOOLEAN DEFAULT FALSE,
  safety_score INT
);

-- DeFi events (derived from transactions + real events)
CREATE TABLE IF NOT EXISTS defi_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  timestamp BIGINT NOT NULL,
  pool_address VARCHAR(64),
  dex VARCHAR(32),
  event_type ENUM('whale', 'large_trade', 'smart_money', 'liquidity_add', 'liquidity_remove', 'new_pool'),
  severity ENUM('high', 'medium', 'low'),
  trader_wallet VARCHAR(64),
  usd_value DECIMAL(16, 2),
  description TEXT,
  INDEX idx_timestamp (timestamp DESC),
  INDEX idx_event_type (event_type, timestamp),
  INDEX idx_severity (severity, timestamp),
  INDEX idx_events_pool_ts (pool_address, timestamp DESC),
  FULLTEXT INDEX idx_events_desc_ft (description) WITH PARSER STANDARD
);

-- Price history (3-min candles, 30 days per pool)
CREATE TABLE IF NOT EXISTS price_history (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  pool_address VARCHAR(64) NOT NULL,
  timestamp BIGINT NOT NULL,
  open DECIMAL(20, 10),
  high DECIMAL(20, 10),
  low DECIMAL(20, 10),
  close DECIMAL(20, 10),
  volume DECIMAL(16, 2),
  INDEX idx_pool_ts (pool_address, timestamp)
);

-- Performance metrics (for TiDB Performance bar)
CREATE TABLE IF NOT EXISTS performance_metrics (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  metric_type VARCHAR(50),
  value DECIMAL(20, 4),
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_type_time (metric_type, recorded_at DESC)
);

-- Event templates (for live event replay)
CREATE TABLE IF NOT EXISTS event_templates (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  event_type VARCHAR(32),
  token_symbol VARCHAR(20),
  token_logo_url VARCHAR(500),
  description_template VARCHAR(500),
  wallet_address VARCHAR(64),
  amount_usd DECIMAL(20, 2),
  dex_name VARCHAR(50),
  tx_hash VARCHAR(128),
  collected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
