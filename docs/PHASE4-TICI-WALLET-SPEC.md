# Phase 4: TiCI Features + Wallet Intelligence

## Overview
Enable TiDB Cloud's unique features (TiCI full-text search, vector search) and derive
real wallet profiles from accumulated swap data. This is the "showcase" phase — the features
that make the demo say "you can't do this with MySQL/Postgres alone."

## Prerequisites
- Phase 1 merged (real pool data from DexScreener)
- Phase 2 merged (real swap transactions from Helius)
- TiDB Cloud Serverless (Starter supports TiCI)
- Branch: `feat/phase4-tici-wallet`

## What Becomes Real

| Feature | Before | After |
|---------|--------|-------|
| Token search | Fake LIKE '%query%' | TiCI full-text search with ranking |
| Event search | Fake LIKE '%whale%' | TiCI full-text search on descriptions |
| Wallet profiles | Seeded fake labels | Derived from real swap patterns |
| Similar tokens | Fake random selection | Vector similarity via TiCI |
| SQL Console search_events | Basic LIKE | Real full-text with MATCH...AGAINST |

---

## Part A: TiCI Full-Text Search

### Why This Matters for Demo
The "search events" preset in SQL Console currently does `WHERE description LIKE '%whale%'`.
With TiCI, we can do ranked full-text search — no Elasticsearch needed. This is a
**headline TiDB differentiator** shown in the comparison table.

### Step 1: Enable TiCI Full-Text Index

```sql
-- Full-text index on defi_events description
ALTER TABLE defi_events ADD FULLTEXT INDEX idx_events_ft (description);

-- Full-text index on pools for token name/symbol search
ALTER TABLE pools ADD FULLTEXT INDEX idx_pools_ft
  (token_base_symbol, token_base_name, token_base_address);

-- Full-text index on swap_transactions for trader search
ALTER TABLE swap_transactions ADD FULLTEXT INDEX idx_swaps_ft
  (trader_wallet, signature);
```

**Note**: TiDB Cloud Serverless supports `ADD FULLTEXT INDEX`. The index is built
on TiFlash columnar storage (TiCI = TiDB Column Index). No external service needed.

### Step 2: Update Search Events Query

#### File: `components/sql-console/QueryChips.tsx`

Change the `search_events` preset SQL from:

```sql
SELECT * FROM defi_events
WHERE description LIKE '%whale%'
ORDER BY timestamp DESC LIMIT 20;
```

To:

```sql
SELECT *, MATCH(description) AGAINST('whale' IN NATURAL LANGUAGE MODE) AS relevance
FROM defi_events
WHERE MATCH(description) AGAINST('whale' IN NATURAL LANGUAGE MODE)
ORDER BY relevance DESC
LIMIT 20;
```

**Update the description** to highlight this:
```
"Full-text search on event descriptions — powered by TiCI (no Elasticsearch needed)"
```

### Step 3: Add Token Search API

#### File: `app/api/search/route.ts` (NEW)

```typescript
import { getPool } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") || "";
  if (q.length < 2) return NextResponse.json({ results: [] });

  const db = getPool();

  // TiCI full-text search across pool tokens
  const [rows] = await db.query(
    `SELECT address, token_base_symbol, token_base_name, token_base_address,
            current_price, logo_url,
            MATCH(token_base_symbol, token_base_name, token_base_address)
              AGAINST(? IN NATURAL LANGUAGE MODE) AS relevance
     FROM pools
     WHERE MATCH(token_base_symbol, token_base_name, token_base_address)
       AGAINST(? IN NATURAL LANGUAGE MODE)
     ORDER BY relevance DESC
     LIMIT 10`,
    [q, q]
  );

  return NextResponse.json({ results: rows, search_engine: "tici" });
}
```

### Step 4: Add Search Box to Main Page

#### File: `components/scanner/SearchBar.tsx` (NEW)

A search input in the main page header that:
- Debounces input (300ms)
- Calls `/api/search?q=...`
- Shows dropdown with matching tokens (icon + name + symbol + price)
- Clicking a result navigates to `/pool/[poolAddress]`
- Shows "Powered by TiCI" badge in dropdown footer

### Step 5: Fallback for Non-TiCI Environments

```typescript
// In the search API:
try {
  // Try TiCI full-text search first
  const [rows] = await db.query(
    `SELECT ... WHERE MATCH(...) AGAINST(? IN NATURAL LANGUAGE MODE) ...`,
    [q]
  );
  return NextResponse.json({ results: rows, search_engine: "tici" });
} catch (e) {
  // Fallback to LIKE if TiCI index doesn't exist
  const [rows] = await db.query(
    `SELECT ... WHERE token_base_symbol LIKE ? OR token_base_name LIKE ? ...`,
    [`%${q}%`, `%${q}%`]
  );
  return NextResponse.json({ results: rows, search_engine: "like_fallback" });
}
```

---

## Part B: Wallet Intelligence (Derived Profiles)

### Why This Matters
Instead of seeded fake wallet labels, derive "whale", "smart_money", "bot" labels
from real swap transaction patterns. This shows TiDB doing **real-time analytics
on transactional data** — the HTAP value proposition.

### Step 6: Wallet Profile Derivation Query

#### File: `app/api/wallets/derive/route.ts` (NEW)

Run this as a scheduled job or on-demand:

```sql
-- Derive wallet profiles from swap patterns
INSERT INTO wallet_profiles (address, label, trade_count, total_volume, first_seen, last_seen)
SELECT
  trader_wallet AS address,
  CASE
    -- Whale: >$50K total volume
    WHEN SUM(usd_value) > 50000 THEN 'whale'
    -- Bot: >100 trades AND avg trade <$100 (high frequency, small size)
    WHEN COUNT(*) > 100 AND AVG(usd_value) < 100 THEN 'bot'
    -- Smart money: >80% win rate on tokens they traded (simplified)
    WHEN COUNT(DISTINCT pool_address) > 5 AND AVG(usd_value) > 500 THEN 'smart_money'
    -- Active trader: >20 trades
    WHEN COUNT(*) > 20 THEN 'active'
    ELSE 'retail'
  END AS label,
  COUNT(*) AS trade_count,
  SUM(usd_value) AS total_volume,
  MIN(block_time) AS first_seen,
  MAX(block_time) AS last_seen
FROM swap_transactions
GROUP BY trader_wallet
ON DUPLICATE KEY UPDATE
  label = VALUES(label),
  trade_count = VALUES(trade_count),
  total_volume = VALUES(total_volume),
  last_seen = VALUES(last_seen);
```

**Key insight for demo**: This single SQL query does what would traditionally require
a batch pipeline (Kafka → Flink → ClickHouse → Redis). TiDB does it in one query
on the same cluster that's ingesting live swaps.

### Step 7: Scheduled Derivation

Run the derivation query:
- After initial data load (Phase 2 Helius backfill)
- Every 6 hours via cron or on-demand API call
- Show "last derived: X minutes ago" in the UI

#### File: `app/api/wallets/derive/route.ts`

```typescript
export async function POST() {
  const db = getPool();
  const start = Date.now();

  await db.query(`/* derivation query from Step 6 */`);

  const [stats] = await db.query(
    `SELECT label, COUNT(*) as count FROM wallet_profiles GROUP BY label`
  );

  return NextResponse.json({
    derived: true,
    duration_ms: Date.now() - start,
    stats,
  });
}
```

### Step 8: Update Wallet Ranking Preset

#### File: `components/sql-console/QueryChips.tsx`

Update the wallet_ranking preset description:
```
"Top wallets ranked by volume — labels derived from real trading patterns using TiDB analytics"
```

Update the smart_money preset description:
```
"Wallets classified as smart money by trade diversity and size — computed in a single SQL query, no ETL pipeline"
```

---

## Part C: Vector Search (Optional, Stretch Goal)

### Why This Matters
Vector search enables "find tokens similar to X" based on trading pattern embeddings.
This is TiCI's vector index capability — no Pinecone/Milvus needed.

### Step 9: Token Embedding Table

```sql
CREATE TABLE IF NOT EXISTS token_embeddings (
  token_address VARCHAR(64) PRIMARY KEY,
  embedding VECTOR(128),  -- TiDB vector type
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_embedding USING HNSW (embedding) WITH (M=16, ef_construction=200)
);
```

### Step 10: Generate Embeddings

Create embeddings from trading patterns (not LLM — simple feature vectors):

```typescript
// Features for each token:
// [volume_24h, txn_count_24h, unique_traders, buy_ratio, avg_trade_size,
//  price_change_1h, price_change_24h, liquidity, holder_count, age_days, ...]

function tokenToVector(pool: PoolData): number[] {
  return [
    Math.log10(pool.volume_24h + 1),
    Math.log10(pool.txn_count_24h + 1),
    Math.log10(pool.unique_traders + 1),
    pool.buys_24h / (pool.buys_24h + pool.sells_24h + 1),
    Math.log10(pool.volume_24h / (pool.txn_count_24h + 1) + 1),
    pool.price_change_1h / 100,
    pool.price_change_24h / 100,
    Math.log10(pool.liquidity + 1),
    Math.log10(pool.holders + 1),
    Math.log10(pool.age_days + 1),
    // ... pad to 128 dimensions
  ];
}
```

### Step 11: Similar Tokens Query

```sql
-- Find tokens most similar to the current one
SELECT p.*, VEC_COSINE_DISTANCE(te.embedding, ?) AS distance
FROM token_embeddings te
JOIN pools p ON p.token_base_address = te.token_address
WHERE te.token_address != ?
ORDER BY distance ASC
LIMIT 5;
```

This replaces the current fake "Similar Patterns" section with real similarity.

---

## Files Summary

| File | Action | Part |
|------|--------|------|
| `app/api/search/route.ts` | NEW | A - Full-text search API |
| `components/scanner/SearchBar.tsx` | NEW | A - Search UI component |
| `components/sql-console/QueryChips.tsx` | MODIFY | A - Update search_events preset |
| `app/api/wallets/derive/route.ts` | NEW | B - Wallet derivation API |
| `components/pool-detail/SimilarPatterns.tsx` | MODIFY | C - Vector similarity |

## TiDB RU Impact

| Operation | Frequency | Monthly RU |
|-----------|-----------|------------|
| Full-text search queries | ~1K/day | ~1.5M |
| Wallet derivation (batch) | 4x/day | ~2M |
| Vector similarity (if enabled) | ~500/day | ~500K |
| **Total Phase 4** | | **~4M RU** |

Combined with Phase 1-3: ~50M RU total — right at the free tier limit.
If over, increase stale thresholds or reduce derivation frequency.

## Demo Script

When showing Phase 4 features:

1. **Search**: Type "sol" in search bar → instant results with relevance ranking
   - "This is TiCI — full-text search built into TiDB. No Elasticsearch cluster to manage."

2. **SQL Console**: Click "search events" → show MATCH...AGAINST query
   - "Same query that would need Elasticsearch, running on TiDB's columnar index."

3. **Wallet Ranking**: Click "wallet ranking" → show derived labels
   - "These labels were computed from raw transaction data using a single SQL query.
      Traditional stacks need Kafka → Flink → ClickHouse → Redis for this."

4. **Similar Tokens** (if vector enabled): Open any token → see similar tokens
   - "Vector similarity search, built into TiDB. No Pinecone. No separate vector DB."

## Estimated Implementation Time
- Human: 1-2 days
- Claude Code: ~45-60 minutes
- Part A (full-text): ~20 min
- Part B (wallet derivation): ~15 min
- Part C (vector, optional): ~20 min
