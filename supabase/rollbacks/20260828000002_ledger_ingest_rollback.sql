-- Rollback Migration: 20260828000002_ledger_ingest_rollback.sql
-- Description: Rollback schema changes for Horizon ledger ingest worker.

BEGIN;

DROP TABLE IF EXISTS ingest_state CASCADE;
DROP INDEX IF EXISTS idx_transactions_tx_hash_op_index;
DROP INDEX IF EXISTS idx_transactions_pending_timeout;
ALTER TABLE transactions DROP COLUMN IF EXISTS op_index;

COMMIT;

