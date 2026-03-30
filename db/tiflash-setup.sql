-- TiFlash Columnar Replica Setup
-- Run once after the cluster is provisioned.
-- TiFlash replication is async — allow a few minutes before querying with tiflash hints.
--
-- Check replication progress:
--   SELECT TABLE_NAME, REPLICA_COUNT, AVAILABLE, PROGRESS
--   FROM information_schema.tiflash_replica
--   WHERE TABLE_SCHEMA = 'chainscope';

USE chainscope;

-- swap_transactions: highest-value TiFlash table
-- Powers: volume aggregations, GROUP BY dex/hour, whale trade scans
ALTER TABLE swap_transactions SET TIFLASH REPLICA 1;

-- pools: needed for ranking/sorting analytics and filter screener
ALTER TABLE pools SET TIFLASH REPLICA 1;

-- defi_events: powers event feed aggregations and FTS on description
ALTER TABLE defi_events SET TIFLASH REPLICA 1;
