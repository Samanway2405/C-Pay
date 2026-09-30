-- Migration: 20260831000001_transactions_readonly_for_clients.sql
-- Issue: #31 — any authenticated user can forge transaction history.
--
-- The transactions table is the payments ledger. Historically the RLS policy
-- "transactions_insert_participant" let any authenticated user INSERT a row as
-- long as their own wallet appeared as sender or recipient, so a user could
-- claim they received any amount, from anyone, with status 'success' and an
-- arbitrary tx_hash.
--
-- This migration is idempotent and additive: it re-asserts the lockdown from
-- 20260829000001. Existing rows are never touched.

BEGIN;

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- 1. Remove every client write path, under all names it has been given.
DROP POLICY IF EXISTS "transactions_insert" ON transactions;
DROP POLICY IF EXISTS "transactions_insert_participant" ON transactions;
DROP POLICY IF EXISTS "transactions_update" ON transactions;
DROP POLICY IF EXISTS "transactions_update_participant" ON transactions;
DROP POLICY IF EXISTS "transactions_delete" ON transactions;
DROP POLICY IF EXISTS "transactions_delete_participant" ON transactions;
DROP POLICY IF EXISTS "transactions_all_participant" ON transactions;

-- 2. Read-only, participant-scoped access for clients.
DROP POLICY IF EXISTS "transactions_select" ON transactions;
DROP POLICY IF EXISTS "transactions_select_participant" ON transactions;
CREATE POLICY "transactions_select_participant" ON transactions
FOR SELECT
USING (
  auth.uid() IS NOT NULL AND (
    from_address = current_wallet_address()
    OR to_address = current_wallet_address()
  )
);

-- 3. The only write path: service_role (relayer / Horizon ingest worker, #16).
DROP POLICY IF EXISTS "transactions_service_all" ON transactions;
CREATE POLICY "transactions_service_all" ON transactions
FOR ALL
USING (auth.jwt() ->> 'role' = 'service_role')
WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

-- 4. Table-level grants, so a client insert fails even if a policy is ever
--    re-added by mistake.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON transactions FROM anon, authenticated;
REVOKE ALL ON transactions FROM anon;
GRANT SELECT ON transactions TO authenticated;
GRANT ALL ON transactions TO service_role;

COMMIT;
