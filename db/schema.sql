-- Token metadata
CREATE TABLE IF NOT EXISTS tokens (
  id VARCHAR(64) PRIMARY KEY,          -- mint address
  symbol VARCHAR(20) NOT NULL,
  name VARCHAR(100),
  logo_url VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Pool data (main table shown in the DEX scanner)
CREATE TABLE IF NOT EXISTS pools (
  id VARCHAR(128) PRIMARY KEY,         -- pool address
  token_base_id VARCHAR(64) NOT NULL,
  token_quote_id VARCHAR(64) NOT NULL,
  pair_label VARCHAR(50),              -- e.g., "OILLESS/SOL"
  dex_name VARCHAR(50),               -- e.g., "Raydium"
  pool_type VARCHAR(20),              -- e.g., "CPMM", "CLMM", "DLMM"
  chain VARCHAR(20) DEFAULT 'solana',
  price_usd DECIMAL(30, 18),
  price_change_5m DECIMAL(10, 2),
  price_change_1h DECIMAL(10, 2),
  price_change_6h DECIMAL(10, 2),
  price_change_24h DECIMAL(10, 2),
  volume_24h DECIMAL(20, 2),
  liquidity_usd DECIMAL(20, 2),
  market_cap DECIMAL(20, 2),
  makers INT,
  txns_24h INT,
  pool_created_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_volume (volume_24h DESC),
  INDEX idx_token_base (token_base_id)
);

-- Transaction history (grows large — TiDB scale story)
CREATE TABLE IF NOT EXISTS transactions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  pool_id VARCHAR(128),
  token_id VARCHAR(64),
  tx_type ENUM('swap_buy', 'swap_sell', 'add_liquidity', 'remove_liquidity'),
  amount_usd DECIMAL(20, 2),
  wallet_address VARCHAR(64),
  tx_hash VARCHAR(128),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_pool_time (pool_id, created_at DESC),
  INDEX idx_token_time (token_id, created_at DESC),
  INDEX idx_created (created_at DESC)
);

-- Live DeFi events (shown in right sidebar — replayed from templates)
CREATE TABLE IF NOT EXISTS defi_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  event_type ENUM('swap', 'whale', 'new_pool', 'liquidity', 'smart_money'),
  token_symbol VARCHAR(20),
  token_logo_url VARCHAR(500),
  description VARCHAR(500),           -- e.g., "bought 14.2M BONK $847K via Raydium"
  wallet_address VARCHAR(64),
  amount_usd DECIMAL(20, 2),
  dex_name VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_type_time (event_type, created_at DESC),
  INDEX idx_created (created_at DESC)
);

-- Event templates (real on-chain events collected once from Helius)
CREATE TABLE IF NOT EXISTS event_templates (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  event_type ENUM('swap', 'whale', 'new_pool', 'liquidity', 'smart_money'),
  token_symbol VARCHAR(20),
  token_logo_url VARCHAR(500),
  description_template VARCHAR(500),  -- e.g., "bought {amount} BONK ${usd} via Raydium"
  wallet_address VARCHAR(64),         -- original wallet (will be randomized on replay)
  amount_usd DECIMAL(20, 2),          -- original amount (will be ±20% on replay)
  dex_name VARCHAR(50),
  tx_hash VARCHAR(128),               -- original tx hash for verification
  collected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Performance metrics (for TiDB Performance bar)
CREATE TABLE IF NOT EXISTS performance_metrics (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  metric_type VARCHAR(50),            -- 'write_throughput', 'query_latency', 'qps', etc.
  value DECIMAL(20, 4),
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_type_time (metric_type, recorded_at DESC)
);
