-- Migration: 20260930000001_payment_limits.sql
-- Description: Server-authoritative payment limits tracking table for daily cap and velocity enforcement.

CREATE TABLE IF NOT EXISTS payment_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth_user_id UUID,
    wallet_address TEXT NOT NULL,
    amount NUMERIC(20, 7) NOT NULL CHECK (amount > 0),
    tx_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_records_auth_user ON payment_records(auth_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_payment_records_wallet ON payment_records(wallet_address, created_at);

ALTER TABLE payment_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payment_records_service_all" ON payment_records
FOR ALL
USING (auth.jwt() ->> 'role' = 'service_role')
WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

REVOKE ALL ON payment_records FROM anon, authenticated;
GRANT ALL ON payment_records TO service_role;
