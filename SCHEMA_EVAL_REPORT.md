# CHAINSCOPE Schema Fitness Evaluation Report

**Date**: 2026-03-30
**Evaluator**: Claude Code
**Codebase version**: `94bb9fe` (branch: `eval/schema-fitness-assessment`)
**Evaluation mode**: SCHEMA FILE EVALUATION — based on `db/schema-v2.sql` (active), `db/schema.sql` (legacy), seed scripts, and API route SQL queries. No live DB access.

---

## Executive Summary

**Overall Score**: 76 / 102 (Domain: 14/18 | TiCI: 11/15 | HTAP: 7/9 | Query: 14/18 | Types: 12/15 | Scale: 6/12 | PRD Gap: 12/15)

**Schema Fitness**: FIT (with caveats)

**P0 Gate Status**:
| Gate ID | Criterion | Score | Status |
|---------|-----------|-------|--------|
| dm_01 | Pool as first-class entity | 3 | PASS |
| dm_03 | Swap transaction modeling | 3 | PASS |
| ti_01 | Full-text index existence | 3 | PASS |
| ht_01 | TiFlash replica existence | 2 | PASS [unverified — needs live DB] |
| qc_01 | Trending table query efficiency | 2 | PASS |
| dt_02 | Price/amount precision | 3 | PASS |
| pg_01 | Core feature coverage | 2 | PASS |

**One-line verdict**: Schema solidly models the pool-centric domain with proper FULLTEXT indexes for TiCI search showcase, but is weakened by missing DDL for 3 tables used in production code (`pattern_embeddings`, `pattern_shape_embeddings`, `pool_stats_live`), a write-hotspot `AUTO_INCREMENT` PK on the highest-throughput table, and zero partitioning strategy for 10M+ scale.

**Top 3 Issues**:
1. **[P0]** `swap_transactions.id BIGINT AUTO_INCREMENT` creates a TiDB write hotspot — all inserts land on one region leader (sc_01)
2. **[P0]** 3 tables + 6 columns used in production code are missing from `schema-v2.sql` — schema file is out of sync with live DB (pg_01, pg_04)
3. **[P1]** No composite indexes for filter modal queries — multi-column filtering (the TiCI showcase) does full scans on non-leading columns (ti_03, qc_04)

---

## Discovered Schema

### Active Schema: `db/schema-v2.sql` (11 tables defined)

```sql
-- 1. tokens (PK: address)
CREATE TABLE tokens (
  address VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128),
  symbol VARCHAR(32),
  decimals INT,
  logo_url VARCHAR(256),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FULLTEXT INDEX idx_tokens_name_ft (name) WITH PARSER STANDARD
);
-- MISSING from DDL but used in code: embedding VECTOR(?), search_popularity INT

-- 2. pools (PK: address)
CREATE TABLE pools (
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
  txns_5m_buys INT, txns_5m_sells INT,
  txns_1h_buys INT, txns_1h_sells INT,
  txns_24h_buys INT, txns_24h_sells INT,
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
-- MISSING from DDL: pool_type column (hardcoded as 'AMM' in API)

-- 3. pool_snapshots (PK: id AUTO_INCREMENT)
CREATE TABLE pool_snapshots (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  pool_address VARCHAR(64),
  snapshot_time TIMESTAMP,
  price_usd DECIMAL(20, 10),
  volume_5m DECIMAL(16, 2), volume_1h DECIMAL(16, 2), volume_24h DECIMAL(16, 2),
  liquidity_usd DECIMAL(16, 2),
  txns_5m INT, txns_1h INT,
  INDEX idx_pool_time (pool_address, snapshot_time),
  INDEX idx_time (snapshot_time)
);

-- 4. swap_transactions (PK: id AUTO_INCREMENT — HOTSPOT RISK)
CREATE TABLE swap_transactions (
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

-- 5. wallet_profiles (PK: address)
CREATE TABLE wallet_profiles (
  address VARCHAR(64) PRIMARY KEY,
  label ENUM('whale', 'smart_money', 'active_trader', 'bot', 'retail'),
  total_volume DECIMAL(20, 2),
  trade_count INT, buy_count INT, sell_count INT,
  pools_traded INT, avg_trade_size DECIMAL(16, 2),
  first_seen BIGINT, last_seen BIGINT,
  INDEX idx_label (label),
  INDEX idx_volume (total_volume DESC)
);

-- 6. token_safety (PK: token_address)
CREATE TABLE token_safety (
  token_address VARCHAR(64) PRIMARY KEY,
  holder_count INT,
  top10_holder_pct DECIMAL(5, 2),
  lp_locked BOOLEAN,
  is_suspicious BOOLEAN DEFAULT FALSE,
  safety_score INT
);
-- MISSING from DDL but used in code: is_mintable, is_freezable, is_verified, is_lp_burned, risk_score

-- 7. defi_events (PK: id AUTO_INCREMENT)
CREATE TABLE defi_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  timestamp BIGINT NOT NULL,
  pool_address VARCHAR(64),
  dex VARCHAR(32),
  event_type ENUM('whale','large_trade','smart_money','liquidity_add','liquidity_remove','new_pool'),
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
-- NOTE: ENUM missing 'swap' type — code inserts 'swap' events

-- 8. price_history (PK: id AUTO_INCREMENT)
CREATE TABLE price_history (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  pool_address VARCHAR(64) NOT NULL,
  timestamp BIGINT NOT NULL,
  open DECIMAL(20, 10), high DECIMAL(20, 10),
  low DECIMAL(20, 10), close DECIMAL(20, 10),
  volume DECIMAL(16, 2),
  INDEX idx_pool_ts (pool_address, timestamp)
);

-- 9. performance_metrics (PK: id AUTO_INCREMENT)
CREATE TABLE performance_metrics (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  metric_type VARCHAR(50),
  value DECIMAL(20, 4),
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_type_time (metric_type, recorded_at DESC)
);

-- 10. api_cache (PK: cache_key)
CREATE TABLE api_cache (
  cache_key VARCHAR(255) PRIMARY KEY,
  value JSON NOT NULL,
  expires_at BIGINT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_expires (expires_at)
);

-- 11. event_templates (PK: id AUTO_INCREMENT)
CREATE TABLE event_templates (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  event_type VARCHAR(32),
  token_symbol VARCHAR(20), token_logo_url VARCHAR(500),
  description_template VARCHAR(500),
  wallet_address VARCHAR(64), amount_usd DECIMAL(20, 2),
  dex_name VARCHAR(50), tx_hash VARCHAR(128),
  collected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Tables NOT in schema-v2.sql but used in production code:

```sql
-- pattern_embeddings (created by scripts/seed-pattern-embeddings.ts)
-- Used by: app/api/pool/[poolAddress]/similar/route.ts, components/sql-console/QueryChips.tsx
-- DDL: NOT FOUND — created manually or in seed script

-- pattern_shape_embeddings (created by scripts/seed-shape-*.ts)
-- Used by: app/api/pool/[poolAddress]/similar/route.ts
-- DDL: NOT FOUND

-- pool_stats_live (referenced in app/api/search/route.ts)
-- Used for: txn_count_24h, unique_traders_24h, buy_sell_ratio enrichment
-- DDL: NOT FOUND
```

---

## Confidence Legend

- **[confirmed]** — Verified from schema files (`db/schema-v2.sql`) or code inspection
- **[inferred]** — Deduced from query patterns in API routes (column/table must exist because query references it)
- **[unverified]** — Cannot determine from available evidence (requires live DB access)

---

## Axis 1: Domain Model Accuracy (14/18)

| ID | Criterion | Must-pass | Score | Confidence | Evidence |
|----|-----------|-----------|-------|------------|----------|
| dm_01 | Pool as first-class entity | ✦ | 3 | confirmed | `db/schema-v2.sql:19-52` — `pools` table is a dedicated first-class entity with `address VARCHAR(64) PRIMARY KEY`, 24 columns covering price, volume (5m/1h/6h/24h), liquidity, market cap, txn counts, dex, and denormalized token symbols. Every API route (`/api/pools`, `/api/pool/[addr]`, `/api/search`) treats pool as the primary entity. |
| dm_02 | Token entity | | 2 | confirmed | `db/schema-v2.sql:8-16` — `tokens` table exists with `address`, `name`, `symbol`, `decimals`, `logo_url`. However, columns `embedding VECTOR(?)` and `search_popularity INT` are referenced in `app/api/search/route.ts` but missing from DDL. Token metadata is partially denormalized into `pools` (base/quote symbols) — acceptable tradeoff. |
| dm_03 | Swap transaction modeling | ✦ | 3 | confirmed | `db/schema-v2.sql:71-88` — `swap_transactions` with `signature`, `timestamp` (BIGINT ms), `pool_address`, `dex`, `side` ENUM, `base_amount`, `quote_amount`, `usd_value`, `trader_wallet`. 6 indexes including composite `idx_pool_ts` and `idx_side_pool`. Supports both OLTP (INSERT IGNORE batches) and OLAP (GROUP BY, SUM, window functions). |
| dm_04 | DEX and pool type modeling | | 2 | confirmed | `db/schema-v2.sql:26` — `dex VARCHAR(32)` exists on `pools`. But NO `pool_type` column in v2 schema (v1 schema.sql:17 had `pool_type VARCHAR(20)`). `app/api/pools/route.ts:130` hardcodes `'AMM' as pool_type`. Same token pair across CLMM/DLMM/CPMM pools cannot be distinguished. |
| dm_05 | Relationship integrity | | 2 | confirmed | No FK constraints defined. Column naming is mostly consistent: `swap_transactions.pool_address` → `pools.address`, `pools.token_base_address` → `tokens.address`, `token_safety.token_address` → `tokens.address`. All VARCHAR(64) — type-consistent. But `swap_transactions.pool_address` is VARCHAR(64) while `pool_snapshots.pool_address` is VARCHAR(64) — consistent. Minor: `event_templates.dex_name` vs `pools.dex` vs `swap_transactions.dex` — naming varies. |
| dm_06 | Time-series data modeling | | 2 | confirmed | `db/schema-v2.sql:135-145` — `price_history` table exists with OHLCV columns and `idx_pool_ts`. However, `app/api/pool/[poolAddress]/ohlcv/route.ts` primarily uses GeckoTerminal as data source with TiDB fallback. The fallback (`route.ts:80-142`) computes OHLCV from raw `swap_transactions` via GROUP BY + GROUP_CONCAT — functional but slow at 10M+ rows. Pre-aggregated `price_history` data is from seed scripts, not continuously updated. |

---

## Axis 2: TiCI Index Strategy (11/15)

| ID | Criterion | Must-pass | Score | Confidence | Evidence |
|----|-----------|-----------|-------|------------|----------|
| ti_01 | Full-text index existence | ✦ | 3 | confirmed | 3 FULLTEXT indexes in `schema-v2.sql`: `tokens.idx_tokens_name_ft (name)` line 15, `pools.idx_pools_symbol_ft (token_base_symbol)` line 51, `defi_events.idx_events_desc_ft (description)` line 131. All use `WITH PARSER STANDARD`. `app/api/search/route.ts:696-722` uses `fts_match_word()` on all three. |
| ti_02 | Vector index for Correlated Tokens | | 2 | inferred | `pattern_embeddings` and `pattern_shape_embeddings` tables exist (populated by `scripts/seed-pattern-embeddings.ts`, `scripts/seed-shape-*.ts`). `app/api/pool/[poolAddress]/similar/route.ts` uses `VEC_COSINE_DISTANCE()`. SQL Console preset (`QueryChips.tsx:111-132`) demos vector search. BUT: no DDL in `schema-v2.sql`, no explicit HNSW/IVF vector index definition found — vector index may not be created. |
| ti_03 | Composite indexes for filter modal | | 1 | confirmed | No composite index covers filter combinations. Individual indexes exist: `idx_volume24h`, `idx_liquidity`, `idx_created`, `idx_dex`. `app/api/search/route.ts` builds dynamic WHERE with `volume_24h >= ?`, `liquidity_usd >= ?`, `pool_created_at >= ?`, `dex = ?` — optimizer picks one index, rest are post-filter. The multi-column TiCI showcase is weakened without a composite index like `(volume_24h, liquidity_usd, pool_created_at)`. |
| ti_04 | Index for trending table sort | | 2 | confirmed | `idx_volume24h (volume_24h DESC)` covers default "Hot" sort. `idx_price_change (price_change_5m DESC)` covers 5m sort. BUT no index on `price_change_24h` — Gainers/Losers sort modes (the most common demo flow) require filesort. No index on `price_change_1h` or `price_change_6h` either. |
| ti_05 | Index for pool detail lookup | | 3 | confirmed | `pools.address VARCHAR(64) PRIMARY KEY` — direct PK point-lookup, optimal. `app/api/pool/[poolAddress]/route.ts:26-67` queries `WHERE p.address = ?`. |

---

## Axis 3: HTAP Workload Fitness (7/9)

| ID | Criterion | Must-pass | Score | Confidence | Evidence |
|----|-----------|-----------|-------|------------|----------|
| ht_01 | TiFlash replica existence | ✦ | 2 | unverified | No `ALTER TABLE ... SET TIFLASH REPLICA` in schema files. However: (1) `lib/db.ts:60-71` has `withTiFlash()` helper that sets `tidb_isolation_read_engines = 'tiflash'`, (2) `scripts/test-05-tiflash.ts:52` attempts `ALTER TABLE swap_transactions SET TIFLASH REPLICA 1`, (3) SQL Console presets use `/*+ READ_FROM_STORAGE(TIFLASH[swap_transactions]) */`. TiFlash replicas are likely configured at the TiDB Cloud console level. Score 2 (not 3) because there's no declarative schema-level guarantee. |
| ht_02 | OLTP vs OLAP separation | | 2 | confirmed | `swap_transactions` = high write (INSERT IGNORE batches) + analytical reads (SUM, GROUP BY). `pools` = moderate writes (periodic UPDATE) + ranking reads (ORDER BY). `performance_metrics` = periodic INSERT + time-range reads. Pattern relies on TiFlash replication to split OLTP/OLAP — correct architecture for TiDB. No write-only vs read-only table separation, but TiFlash handles it. Score 2 because it works but depends on TiFlash being correctly configured. |
| ht_03 | Analytical query hint usage | | 3 | confirmed | SQL Console presets explicitly use `/*+ READ_FROM_STORAGE(TIFLASH[swap_transactions]) */` (`QueryChips.tsx:15,33,54,141`). Code has `withTiFlash()` helper for programmatic TiFlash routing. `app/api/search/route.ts:135-142` comments note "TiDB optimizer auto-routes to TiFlash for full scans." Good mix of explicit hints (for demo consistency) and optimizer reliance (for production). |

---

## Axis 4: Query Coverage (14/18)

| ID | Criterion | Must-pass | Score | Confidence | Evidence |
|----|-----------|-----------|-------|------------|----------|
| qc_01 | Trending table query efficiency | ✦ | 2 | confirmed | `app/api/pools/route.ts:116-154` — `ORDER BY p.volume_24h DESC LIMIT ? OFFSET ?` uses `idx_volume24h`. Has LEFT JOINs to `tokens` for logo/name which may prevent pure index-only scan. Other sort modes (`price_change_24h`) lack dedicated indexes — filesort on non-default sorts. Score 2: default sort is indexed, but JOINs + alternate sorts add latency. |
| qc_02 | Search query efficiency | | 3 | confirmed | `app/api/search/route.ts:690-722` — 3 parallel FTS queries using `fts_match_word()` on FULLTEXT-indexed columns. Address search uses exact PK match (`WHERE p.address = ?`). Wallet search uses `idx_wallet`. LIKE is only a fallback when FTS returns no results (`route.ts:770+`). Comprehensive multi-strategy search with proper index usage. |
| qc_03 | Pool detail query efficiency | | 3 | confirmed | `app/api/pool/[poolAddress]/route.ts:26-67` — PK lookup `WHERE p.address = ?`. LEFT JOINs to `tokens` (on PK) and `token_safety` (on PK). Events count uses `WHERE pool_address = ? AND timestamp >= ?` with `idx_events_pool_ts`. OHLCV from GeckoTerminal (external API, ~200ms) with TiDB fallback. |
| qc_04 | Filter modal query efficiency | | 1 | confirmed | `app/api/search/route.ts:150-250` — dynamic WHERE: `volume_24h >= ?`, `liquidity_usd >= ?`, `pool_created_at >= ?`, `dex = ?`. No composite index covers combinations — optimizer picks one single-column index, scans the rest. For the TiCI multi-column index showcase, this is a significant gap. Also used in `/api/pools` filter path. |
| qc_05 | Aggregation query efficiency | | 2 | confirmed | `app/api/stats/route.ts:18-23` — 4 parallel `COUNT(*)` on `tokens`, `pools`, `swap_transactions`, `defi_events`. No TiFlash hints on these counts. `COUNT(*) FROM swap_transactions` on 1M+ rows relies on app-level SWR cache (60s TTL). SQL Console aggregations correctly use TiFlash hints. Score 2: works via caching but raw counts are expensive. |
| qc_06 | N+1 query detection | | 3 | confirmed | `app/api/pools/route.ts:116-154` — single query with LEFT JOINs for token info. `app/api/search/route.ts` uses `WHERE address IN (...)` batch lookups for enrichment. No per-row sub-queries detected in any hot path. |

---

## Axis 5: Data Type Appropriateness (12/15)

| ID | Criterion | Must-pass | Score | Confidence | Evidence |
|----|-----------|-----------|-------|------------|----------|
| dt_01 | Address column types | | 2 | confirmed | Solana addresses: `VARCHAR(64)` — accommodates 32-44 char base58. Signatures: `VARCHAR(128)` — appropriate for 88-char base58 tx signatures. Pool addresses at DexScreener are longer than mint addresses, hence VARCHAR(64) is tight but sufficient. No `TEXT` usage for addresses. Minor inconsistency: no enforced lowercase/checksum convention. |
| dt_02 | Price/amount precision | ✦ | 3 | confirmed | `price_usd DECIMAL(20, 10)` — handles both micro-prices (0.000000001) and large prices. `volume/liquidity DECIMAL(16, 2)`, `usd_value DECIMAL(16, 2)`, `base_amount DECIMAL(20, 6)`. **No FLOAT or DOUBLE anywhere in the schema.** All financial values use DECIMAL. |
| dt_03 | Timestamp handling | | 2 | confirmed | Mixed but intentional: blockchain timestamps use `BIGINT` (unix ms) — `swap_transactions.timestamp`, `pools.pool_created_at`, `defi_events.timestamp`. DB-managed timestamps use `TIMESTAMP` — `pools.last_updated`, `performance_metrics.recorded_at`. Consistent within each domain. But time-range queries must handle both formats — `defi_events` uses `UNIX_TIMESTAMP() * 1000 - 86400000` while `performance_metrics` uses `NOW() - INTERVAL 5 MINUTE`. |
| dt_04 | Enum-like columns | | 3 | confirmed | `side ENUM('buy', 'sell')`, `event_type ENUM(...)`, `severity ENUM(...)`, `label ENUM(...)` — proper ENUM usage for constrained values. `dex VARCHAR(32)` is free-text but values come from external APIs (DexScreener) — ENUM would break on new DEXes. Pragmatic choice. |
| dt_05 | Boolean/status columns | | 2 | confirmed | `token_safety.lp_locked BOOLEAN`, `is_suspicious BOOLEAN DEFAULT FALSE` — correct type. But `schema-v2.sql` is missing `is_mintable`, `is_freezable`, `is_verified`, `is_lp_burned` BOOLEANs that `app/api/search/route.ts` and `QueryChips.tsx:165-167` reference. The `token_safety` DDL is incomplete vs what the code expects. |

---

## Axis 6: Scale Readiness (6/12)

| ID | Criterion | Must-pass | Score | Confidence | Evidence |
|----|-----------|-----------|-------|------------|----------|
| sc_01 | Primary key strategy | | 1 | confirmed | **`swap_transactions.id BIGINT AUTO_INCREMENT`** — on TiDB, all AUTO_INCREMENT inserts go to the same region leader, creating a write hotspot. This is the highest-throughput table (~70K rows/day growing). Should use `AUTO_RANDOM` or natural key (`signature`). Other tables: `pools.address` (natural PK, hash distribution — good), `tokens.address` (good), `wallet_profiles.address` (good). |
| sc_02 | Partitioning strategy | | 0 | confirmed | No `PARTITION BY` on any table. `swap_transactions` target is 10M+ rows with timestamp-based queries (`WHERE timestamp > ?`) — no partition pruning available. `defi_events` has 7-day retention via application-level DELETE but no partition-based cleanup. No data lifecycle strategy at schema level. |
| sc_03 | Row size estimation | | 2 | inferred | `swap_transactions`: ~350 bytes/row (VARCHAR(128) + VARCHAR(64)×2 + VARCHAR(32) + BIGINT + DECIMAL×3 + ENUM + indexes). At 10M rows: ~3.5GB data + ~2GB indexes = ~5.5GB. `pools`: ~600 bytes × 15K = ~9MB. `defi_events`: ~300 bytes × 100K = ~30MB. Well within TiDB Essential tier limits. `defi_events.description TEXT` is the only variable-length concern. |
| sc_04 | Denormalization strategy | | 3 | confirmed | `pools` includes `token_base_symbol`, `token_quote_symbol` — eliminates JOIN for the main table's pair label. `app/api/pools/route.ts` still JOINs for `logo_url` and `name` (not denormalized, acceptable — changes infrequently). `swap_transactions` includes `dex` (denormalized from `pools.dex`) for direct aggregation without JOIN. Good balance — avoids both extreme normalization and update anomalies. |

---

## Axis 7: PRD ↔ Schema Gap (12/15)

| ID | Criterion | Must-pass | Score | Confidence | Evidence |
|----|-----------|-----------|-------|------------|----------|
| pg_01 | Core feature coverage | ✦ | 2 | confirmed | **Trending table**: pools has volume_24h, price_change_*, liquidity — covered. **Pool detail**: pools + swap_transactions + token_safety — covered. **Search**: FULLTEXT on pools.symbol, tokens.name, events.description — covered. **Filter**: columns exist but composite indexes missing. **However**: 3 tables used in production API routes (`pattern_embeddings`, `pattern_shape_embeddings`, `pool_stats_live`) have no DDL in `schema-v2.sql`. 6 columns on existing tables (`tokens.embedding`, `tokens.search_popularity`, `token_safety.is_mintable/is_freezable/is_verified/is_lp_burned`) are also missing from DDL. Score 2 — core works but schema file is incomplete. |
| pg_02 | Live Events feed support | | 3 | confirmed | `defi_events` table with type ENUM, severity, timestamps, pool_address. Indexed for type + time queries. Lazy generation from template sampling (UNION queries in `app/api/events/route.ts`). 7-day retention via application cleanup. Well-supported. |
| pg_03 | Correlated Tokens / vector support | | 2 | inferred | `pattern_embeddings` and `pattern_shape_embeddings` exist in live DB (populated by seed scripts). `VEC_COSINE_DISTANCE()` queries work in `/api/pool/[addr]/similar` and SQL Console. But NO DDL in `schema-v2.sql`, no explicit vector index (HNSW) definition found. A fresh `schema-v2.sql` deployment would not create these tables. |
| pg_04 | SQL Console preset compatibility | | 2 | confirmed | 7 presets in `QueryChips.tsx`. 5 presets use correct table/column names from `schema-v2.sql`. **"token safety"** preset (`line 158-170`) references `ts.is_mintable`, `ts.is_lp_burned`, `ts.risk_score` — `is_mintable` and `is_lp_burned` are NOT in `schema-v2.sql`'s `token_safety` DDL. **"search events"** (`line 94-101`) uses `LIKE '%whale%'` instead of `fts_match_word()` — misses TiCI demo opportunity. **"similar tokens"** (`line 111-132`) references `pattern_embeddings` — no DDL. |
| pg_05 | Performance Bar data support | | 3 | confirmed | `performance_metrics` table with `metric_type`, `value`, `recorded_at`. `app/api/metrics/route.ts` inserts real measured values (connection pool stats, query timing). Sparkline data from `WHERE recorded_at > NOW() - INTERVAL 5 MINUTE`. History aggregation with time-bucketing. Not hardcoded — actual measurements. |

---

## Action Items

### P0 — Schema-breaking (fix before next presales demo)

- [ ] **sc_01**: `swap_transactions.id BIGINT AUTO_INCREMENT` creates write hotspot on TiDB — `db/schema-v2.sql:72` — Fix: `ALTER TABLE swap_transactions MODIFY id BIGINT AUTO_RANDOM;` or use `signature` as natural PK: `ALTER TABLE swap_transactions DROP PRIMARY KEY, ADD PRIMARY KEY (signature);` (requires dedup strategy change from INSERT IGNORE to ON DUPLICATE KEY).

- [ ] **pg_01/pg_04**: Schema-v2.sql is missing 3 tables and 6 columns used in production — Add DDL for `pattern_embeddings`, `pattern_shape_embeddings`, `pool_stats_live` to `schema-v2.sql`. Add missing columns: `ALTER TABLE tokens ADD COLUMN embedding VECTOR(32), ADD COLUMN search_popularity INT DEFAULT 0;` and `ALTER TABLE token_safety ADD COLUMN is_mintable BOOLEAN DEFAULT FALSE, ADD COLUMN is_freezable BOOLEAN DEFAULT FALSE, ADD COLUMN is_verified BOOLEAN DEFAULT FALSE, ADD COLUMN is_lp_burned BOOLEAN DEFAULT FALSE, ADD COLUMN risk_score INT;`.

- [ ] **defi_events ENUM**: Event type ENUM missing 'swap' — `db/schema-v2.sql:122` — Fix: `ALTER TABLE defi_events MODIFY event_type ENUM('swap','whale','large_trade','smart_money','liquidity_add','liquidity_remove','new_pool');` (currently 'swap' insertions silently fail or get empty string).

### P1 — Noticeable gap (fix within 1-2 sprints)

- [ ] **ti_03/qc_04**: No composite index for filter modal — `db/schema-v2.sql:45-51` — Add: `CREATE INDEX idx_screener_composite ON pools (volume_24h DESC, liquidity_usd DESC, pool_created_at DESC);` or a TiCI multi-column inverted index if available. This is the filter showcase — without it, filtering defeats the TiCI pitch.

- [ ] **ti_04**: Missing indexes for sort modes — `db/schema-v2.sql` — Add: `CREATE INDEX idx_price_change_24h ON pools (price_change_24h DESC);` and `CREATE INDEX idx_price_change_1h ON pools (price_change_1h DESC);` for Gainers/Losers sort modes.

- [ ] **dm_04**: Missing `pool_type` column — `db/schema-v2.sql:19` — Add: `ALTER TABLE pools ADD COLUMN pool_type VARCHAR(20) DEFAULT 'AMM';` — enables filtering by AMM/CLMM/DLMM and removes hardcoded `'AMM'` from `app/api/pools/route.ts:130`.

- [ ] **pg_04**: SQL Console "search events" preset uses LIKE not FTS — `QueryChips.tsx:94-101` — Replace `WHERE description LIKE '%whale%'` with `WHERE fts_match_word('whale', description)` to showcase TiCI during demos.

- [ ] **ht_01**: No declarative TiFlash configuration in schema — Create `db/tiflash-setup.sql`: `ALTER TABLE swap_transactions SET TIFLASH REPLICA 1; ALTER TABLE pools SET TIFLASH REPLICA 1; ALTER TABLE defi_events SET TIFLASH REPLICA 1;` — makes HTAP setup reproducible and documents which tables need columnar replicas.

### P2 — Optimization / polish

- [ ] **sc_02**: No partitioning on swap_transactions — `db/schema-v2.sql:71` — Future: `ALTER TABLE swap_transactions PARTITION BY RANGE (timestamp) (...)` with monthly partitions. Not critical at 10M but essential at 100M+.

- [ ] **dm_02**: Missing `tokens.embedding` and `search_popularity` from DDL — `db/schema-v2.sql:8-16` — Add columns to DDL so fresh deployments match production.

- [ ] **dt_03**: Mixed timestamp formats — Consider standardizing on BIGINT (unix ms) for all event-related tables, or documenting the convention clearly in schema comments.

- [ ] **dm_06**: OHLCV fallback computes from raw swaps — `app/api/pool/[poolAddress]/ohlcv/route.ts:80-142` — At scale, add a continuous aggregation job to populate `price_history` from `swap_transactions`, removing the expensive GROUP_CONCAT fallback.

- [ ] **pg_03**: No vector index DDL — Add `CREATE VECTOR INDEX ON pattern_embeddings (embedding) USING HNSW;` to schema files for reproducible vector search setup.

---

## Product Verdict

CHAINSCOPE's schema is fundamentally sound for its dual role as product and presales tool — the pool-centric model is correct, FULLTEXT indexes enable a genuine TiCI full-text search showcase, and the HTAP architecture (TiKV + TiFlash helpers, explicit query hints in SQL Console) tells the right distributed database story. The highest-leverage fix is changing `swap_transactions.id` from `AUTO_INCREMENT` to `AUTO_RANDOM`, which eliminates the single-region write hotspot that would visibly degrade under load during a live demo — this is a one-line ALTER TABLE that immediately improves the scale story. The second priority is synchronizing `schema-v2.sql` with the live database (3 missing tables, 6 missing columns) so that the schema file is a reliable single source of truth for onboarding and disaster recovery. With those two fixes, the schema moves from "FIT with caveats" to "FIT" for TiDB presales engagements targeting Web3 prospects.

---

## Appendix: Key File Paths

| Artifact | Path |
|----------|------|
| Schema (active, v2) | `db/schema-v2.sql` |
| Schema (legacy, v1) | `db/schema.sql` |
| DB connection pool | `lib/db.ts` |
| DB edge connection | `lib/db-edge.ts` |
| TypeScript types | `lib/types.ts` |
| Pool list API | `app/api/pools/route.ts` |
| Pool detail API | `app/api/pool/[poolAddress]/route.ts` |
| Search API | `app/api/search/route.ts` |
| Events API | `app/api/events/route.ts` |
| OHLCV API | `app/api/pool/[poolAddress]/ohlcv/route.ts` |
| Similar pools API | `app/api/pool/[poolAddress]/similar/route.ts` |
| Transactions API | `app/api/pool/[poolAddress]/transactions/route.ts` |
| Top traders API | `app/api/pool/[poolAddress]/top-traders/route.ts` |
| Stats API | `app/api/stats/route.ts` |
| Metrics API | `app/api/metrics/route.ts` |
| SQL Console presets | `components/sql-console/QueryChips.tsx` |
| Seed script (v2) | `scripts/seed-v2.ts` |
| Pattern embeddings seed | `scripts/seed-pattern-embeddings.ts` |
| Shape embeddings seed | `scripts/seed-shape-from-swaps.ts` |
| TiFlash test script | `scripts/test-05-tiflash.ts` |
| PRD | `CHAINSCOPE_PRD.md` |
| Workload spec | `WORKLOAD_SPEC.md` |
| TiCI usage report | `TICI_USAGE_REPORT.md` |
| API reference | `CHAINSCOPE_API_REFERENCE.md` |

## Appendix: Full Query Inventory

| # | Query (abbreviated) | Source file | Feature | Index coverage |
|---|---------------------|-------------|---------|----------------|
| 1 | `SELECT COUNT(*) FROM pools p LEFT JOIN tokens ... WHERE {filters}` | `app/api/pools/route.ts:108` | Pool count | Depends on filter — partial |
| 2 | `SELECT p.*, t_base.*, t_quote.* FROM pools p LEFT JOIN tokens ... ORDER BY {sort} LIMIT ? OFFSET ?` | `app/api/pools/route.ts:116-154` | Trending table | idx_volume24h for default sort |
| 3 | `SELECT p.*, t.* FROM pools p LEFT JOIN tokens t ... WHERE volume_24h > 1000 ORDER BY price_change_24h DESC LIMIT 5` | `app/api/search/trending/route.ts:22-32` | Gainers | No idx on price_change_24h |
| 4 | `SELECT de.*, p.token_base_symbol FROM defi_events de LEFT JOIN pools p ... WHERE event_type IN ('whale','smart_money') ORDER BY timestamp DESC LIMIT 5` | `app/api/search/trending/route.ts:34-43` | Whale alerts | idx_event_type |
| 5 | `SELECT p.*, t.* FROM pools p LEFT JOIN tokens t ... WHERE pool_created_at IS NOT NULL ORDER BY pool_created_at DESC LIMIT 3` | `app/api/search/trending/route.ts:45-56` | New pools | idx_created |
| 6 | `SELECT p.*, t_base.*, t_quote.*, ts.holder_count FROM pools p LEFT JOIN tokens ... LEFT JOIN token_safety ts ... WHERE p.address = ?` | `app/api/pool/[poolAddress]/route.ts:26-67` | Pool detail | PK lookup |
| 7 | `SELECT COUNT(*) FROM defi_events WHERE pool_address = ? AND timestamp >= ?` | `app/api/pool/[poolAddress]/route.ts:69` | Pool event count | idx_events_pool_ts |
| 8 | `SELECT DISTINCT token_base_symbol, token_base_address FROM pools` | `app/api/search/route.ts:~200` | Fuzzy cache | Full scan |
| 9 | `SELECT p.*, t.* FROM pools p LEFT JOIN tokens t ... WHERE {dynamic filters} ORDER BY {sort} LIMIT 50` | `app/api/search/route.ts:150-250` | Filter-only screener | Partial — single index |
| 10 | `SELECT p.* FROM pools p LEFT JOIN tokens t ... WHERE p.address = ? OR p.token_base_address = ?` | `app/api/search/route.ts:~630` | Address search | PK + idx_base_token |
| 11 | `SELECT s.*, p.* FROM swap_transactions s LEFT JOIN pools p ... WHERE s.trader_wallet = ? ORDER BY s.timestamp DESC LIMIT 20` | `app/api/search/route.ts:~645` | Wallet search | idx_wallet |
| 12 | `SELECT p.* FROM pools p LEFT JOIN tokens t ... WHERE LOWER(token_base_symbol) = LOWER(?)` | `app/api/search/route.ts:~654` | Exact symbol | Function on column — no index |
| 13 | `SELECT p.* FROM pools p LEFT JOIN tokens t ... WHERE LOWER(token_base_symbol) LIKE ?` | `app/api/search/route.ts:~670` | Prefix autocomplete | No index (LOWER + LIKE) |
| 14 | `SELECT p.*, fts_match_word(?, p.token_base_symbol) AS relevance FROM pools p WHERE fts_match_word(...) ORDER BY relevance DESC LIMIT 50` | `app/api/search/route.ts:690-700` | FTS symbol search | FULLTEXT idx_pools_symbol_ft |
| 15 | `SELECT t.*, fts_match_word(?, t.name) AS relevance FROM tokens t WHERE fts_match_word(...) ORDER BY relevance DESC LIMIT 20` | `app/api/search/route.ts:703-710` | FTS name search | FULLTEXT idx_tokens_name_ft |
| 16 | `SELECT de.*, fts_match_word(?, de.description) AS relevance FROM defi_events de WHERE fts_match_word(...) ORDER BY relevance DESC LIMIT 5` | `app/api/search/route.ts:716-723` | FTS event search | FULLTEXT idx_events_desc_ft |
| 17 | `SELECT t.*, VEC_COSINE_DISTANCE(t.embedding, ?) AS distance FROM tokens t WHERE embedding IS NOT NULL ORDER BY distance LIMIT 20` | `app/api/search/route.ts:~740` | Vector search | ? unknown — no DDL |
| 18 | `SELECT p.* FROM pools p WHERE token_base_address IN (...)` | `app/api/search/route.ts:~756` | Token→pool lookup | idx_base_token |
| 19 | `UPDATE tokens SET search_popularity = LEAST(COALESCE(search_popularity, 0) + 1, 10000) WHERE address = ?` | `app/api/search/click/route.ts:29` | Click tracking | PK lookup |
| 20 | `SELECT id, event_type, severity, description, timestamp, dex, trader_wallet, usd_value FROM defi_events WHERE pool_address = ? ORDER BY timestamp DESC LIMIT ?` | `app/api/pool/[poolAddress]/events/route.ts:45-59` | Pool events | idx_events_pool_ts |
| 21 | `SELECT st.*, wp.label FROM swap_transactions st LEFT JOIN wallet_profiles wp ... WHERE st.pool_address = ? {filters} ORDER BY st.timestamp DESC LIMIT ? OFFSET ?` | `app/api/pool/[poolAddress]/transactions/route.ts:90-160` | Pool transactions | idx_pool_ts |
| 22 | `SELECT st.trader_wallet, SUM(usd_value), ... FROM swap_transactions st LEFT JOIN wallet_profiles wp ... WHERE pool_address = ? GROUP BY trader_wallet ORDER BY volume_usd DESC LIMIT ?` | `app/api/pool/[poolAddress]/top-traders/route.ts:22-37` | Top traders | idx_pool_ts |
| 23 | `SELECT FLOOR(timestamp/?) * ? AS bucket_time, ... FROM swap_transactions WHERE pool_address = ? AND ... GROUP BY bucket_time ORDER BY bucket_time DESC LIMIT ?` | `app/api/pool/[poolAddress]/ohlcv/route.ts:80-120` | OHLCV fallback | idx_pool_ts |
| 24 | `SELECT pe.*, (1 - VEC_COSINE_DISTANCE(pe.embedding, ...)) AS similarity FROM pattern_embeddings pe WHERE pool_address != ? ORDER BY similarity DESC LIMIT ?` | `app/api/pool/[poolAddress]/similar/route.ts:42-68` | Similar pools | ? unknown — no DDL |
| 25 | `SELECT ... FROM defi_events WHERE 1=1 {type filter} {amount filter} ORDER BY timestamp DESC LIMIT ? OFFSET ?` | `app/api/events/route.ts:140-167` | Global events | idx_event_type or idx_timestamp |
| 26 | `SELECT p.* FROM pools p WHERE token_base_address = ? ORDER BY volume_24h DESC` | `app/api/token/[tokenAddress]/pools/route.ts:19-30` | Token pools | idx_base_token |
| 27 | `SELECT m.metric_type, m.value, m.recorded_at FROM performance_metrics m INNER JOIN (...MAX...) ... ` | `app/api/metrics/route.ts:35-42` | Latest metrics | idx_type_time |
| 28 | `SELECT metric_type, value, recorded_at FROM performance_metrics WHERE recorded_at > NOW() - INTERVAL 5 MINUTE` | `app/api/metrics/route.ts:45-48` | Sparkline | idx_type_time |
| 29 | `SELECT COUNT(*) FROM tokens / pools / swap_transactions / defi_events` | `app/api/stats/route.ts:18-23` | Global stats | Full scan (cached) |
| 30 | `INSERT INTO performance_metrics (metric_type, value, recorded_at) VALUES (...)` | `app/api/metrics/route.ts:58-60` | Metrics write | N/A (insert) |
| 31 | `INSERT IGNORE INTO swap_transactions (...) VALUES (...)` | `app/api/pool/[poolAddress]/transactions/route.ts:80-90` | Lazy tx gen | N/A (insert) |
| 32 | `INSERT INTO defi_events (...) VALUES (...)` | `app/api/events/route.ts:95-105` | Lazy event gen | N/A (insert) |
