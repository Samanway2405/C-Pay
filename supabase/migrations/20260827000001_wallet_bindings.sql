-- Migration: 20260827000001_wallet_bindings.sql
-- Description: Bind authenticated Supabase users to the Stellar wallets they own.

CREATE TABLE IF NOT EXISTS wallet_bindings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    wallet_address TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(auth_user_id, wallet_address)
);

INSERT INTO wallet_bindings (auth_user_id, wallet_address)
SELECT auth_user_id, wallet_address
FROM users
WHERE auth_user_id IS NOT NULL AND wallet_address IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE wallet_bindings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wallet_bindings_select_own" ON wallet_bindings
FOR SELECT USING (auth_user_id = auth.uid());

CREATE POLICY "wallet_bindings_insert_own" ON wallet_bindings
FOR INSERT WITH CHECK (auth_user_id = auth.uid());

CREATE POLICY "wallet_bindings_update_own" ON wallet_bindings
FOR UPDATE USING (auth_user_id = auth.uid());
