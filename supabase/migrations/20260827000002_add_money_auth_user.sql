-- Migration: 20260827000002_add_money_auth_user.sql
-- Description: Key Add Money cooldown and daily-cap queries by authenticated user.

ALTER TABLE add_money_claims
  ADD COLUMN IF NOT EXISTS auth_user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_add_money_claims_auth_user_id
  ON add_money_claims(auth_user_id);

CREATE INDEX IF NOT EXISTS idx_add_money_claims_auth_user_id_claimed_at
  ON add_money_claims(auth_user_id, claimed_at DESC);
