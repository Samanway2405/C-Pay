-- Rollback Migration: 20260831000001_transactions_readonly_for_clients_rollback.sql
-- Description: Restore the pre-#31 participant SELECT policy shape.
--
-- WARNING: this rollback deliberately does NOT restore client INSERT/UPDATE on
-- transactions. Those policies allowed any authenticated user to forge ledger
-- rows and merchant revenue; re-adding them would reintroduce the vulnerability.
-- Only the merchant-scoped SELECT branch is reverted.

BEGIN;

DROP POLICY IF EXISTS "transactions_select_participant" ON transactions;
CREATE POLICY "transactions_select_participant" ON transactions
FOR SELECT
USING (
  auth.uid() IS NOT NULL AND (
    from_address = current_wallet_address()
    OR to_address = current_wallet_address()
  )
);

COMMIT;
