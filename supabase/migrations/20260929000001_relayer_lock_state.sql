-- Migration: 20260929000001_relayer_lock_state.sql
-- Description: Allow NULL responses to represent persisted in-flight relayer locks.

ALTER TABLE relayer_idempotency_keys
  ALTER COLUMN response DROP NOT NULL;
