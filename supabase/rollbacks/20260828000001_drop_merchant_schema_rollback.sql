-- Rollback Migration: 20260828000001_drop_merchant_schema_rollback.sql
-- Description: Recreate merchant tables, functions, triggers, columns, and CHECK constraints.

BEGIN;

-- 1. Recreate merchants table
CREATE TABLE IF NOT EXISTS merchants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    business_name TEXT NOT NULL,
    wallet_address TEXT UNIQUE NOT NULL,
    cpay_id TEXT UNIQUE,
    owner_name TEXT,
    email TEXT,
    phone_number TEXT,
    business_address TEXT,
    business_registration_number TEXT,
    description TEXT,
    category TEXT,
    logo_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (
        verification_status IN ('pending', 'approved', 'rejected')
    ),
    verified_contact_email TEXT,
    contact_email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    submitted_at TIMESTAMPTZ,
    reviewed_at TIMESTAMPTZ,
    rejection_reason TEXT,
    total_transactions INTEGER NOT NULL DEFAULT 0,
    total_revenue NUMERIC(20, 7) NOT NULL DEFAULT 0,
    stellar_network TEXT NOT NULL DEFAULT 'testnet',
    asset_code TEXT NOT NULL DEFAULT 'USDC',
    asset_issuer TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Recreate merchant_qr_codes table
CREATE TABLE IF NOT EXISTS merchant_qr_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
    qr_name TEXT NOT NULL,
    amount NUMERIC(20, 7),
    asset_code TEXT NOT NULL DEFAULT 'USDC',
    asset_issuer TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    scan_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Recreate merchant_contact_verifications table
CREATE TABLE IF NOT EXISTS merchant_contact_verifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
    contact_email TEXT NOT NULL,
    otp_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    verified_at TIMESTAMPTZ,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Recreate columns on transactions
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS merchant_id UUID REFERENCES merchants(id) ON DELETE SET NULL;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS merchant_name TEXT;

-- 5. Restore transaction_type CHECK constraint to include 'merchant'
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'transactions'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%transaction_type%'
    ) LOOP
        EXECUTE 'ALTER TABLE transactions DROP CONSTRAINT ' || quote_ident(r.conname);
    END LOOP;
END $$;

ALTER TABLE transactions
ADD CONSTRAINT transactions_transaction_type_check
CHECK (transaction_type IN ('personal', 'merchant', 'add_money', 'account_setup'));

-- 6. Recreate indexes
CREATE INDEX IF NOT EXISTS idx_merchants_wallet_address ON merchants(wallet_address);
CREATE INDEX IF NOT EXISTS idx_merchants_auth_user_id ON merchants(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_merchants_cpay_id ON merchants(cpay_id);
CREATE INDEX IF NOT EXISTS idx_transactions_merchant_id ON transactions(merchant_id);
CREATE INDEX IF NOT EXISTS idx_merchant_qr_codes_merchant_id ON merchant_qr_codes(merchant_id);
CREATE INDEX IF NOT EXISTS idx_merchant_contact_verifications_auth_user ON merchant_contact_verifications(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_merchant_contact_verifications_merchant ON merchant_contact_verifications(merchant_id);

-- 7. Recreate updated_at triggers
DROP TRIGGER IF EXISTS update_merchants_updated_at ON merchants;
CREATE TRIGGER update_merchants_updated_at
BEFORE UPDATE ON merchants
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_merchant_qr_codes_updated_at ON merchant_qr_codes;
CREATE TRIGGER update_merchant_qr_codes_updated_at
BEFORE UPDATE ON merchant_qr_codes
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_merchant_contact_verifications_updated_at ON merchant_contact_verifications;
CREATE TRIGGER update_merchant_contact_verifications_updated_at
BEFORE UPDATE ON merchant_contact_verifications
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 8. Recreate functions
CREATE OR REPLACE FUNCTION refresh_merchant_totals(p_merchant_id UUID)
RETURNS VOID AS $$
BEGIN
  IF p_merchant_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE merchants m
  SET
    total_transactions = COALESCE((
      SELECT COUNT(*)::INTEGER
      FROM transactions t
      WHERE t.merchant_id = p_merchant_id
        AND t.transaction_type = 'merchant'
        AND t.status = 'success'
    ), 0),
    total_revenue = COALESCE((
      SELECT SUM(t.amount)
      FROM transactions t
      WHERE t.merchant_id = p_merchant_id
        AND t.transaction_type = 'merchant'
        AND t.status = 'success'
    ), 0),
    updated_at = NOW()
  WHERE m.id = p_merchant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION update_merchant_totals_from_transaction()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM refresh_merchant_totals(OLD.merchant_id);
    RETURN OLD;
  END IF;

  PERFORM refresh_merchant_totals(NEW.merchant_id);

  IF TG_OP = 'UPDATE' AND OLD.merchant_id IS DISTINCT FROM NEW.merchant_id THEN
    PERFORM refresh_merchant_totals(OLD.merchant_id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS update_merchant_totals_on_transactions ON transactions;
CREATE TRIGGER update_merchant_totals_on_transactions
AFTER INSERT OR UPDATE OR DELETE ON transactions
FOR EACH ROW EXECUTE FUNCTION update_merchant_totals_from_transaction();

CREATE OR REPLACE FUNCTION resolve_cpay_id(p_cpay_id TEXT)
RETURNS TABLE (
  wallet_address TEXT,
  cpay_id TEXT,
  display_name TEXT,
  account_type TEXT
) AS $$
  SELECT u.wallet_address, u.cpay_id, u.display_name, 'user'::TEXT
  FROM users u
  WHERE lower(u.cpay_id) = lower(p_cpay_id)
  UNION ALL
  SELECT m.wallet_address, m.cpay_id, m.business_name AS display_name, 'merchant'::TEXT
  FROM merchants m
  WHERE lower(m.cpay_id) = lower(p_cpay_id) AND m.is_active = TRUE
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION get_public_merchant_by_id(p_merchant_id UUID)
RETURNS TABLE (
  id UUID,
  business_name TEXT,
  wallet_address TEXT,
  cpay_id TEXT,
  category TEXT,
  description TEXT,
  logo_url TEXT,
  is_active BOOLEAN
) AS $$
  SELECT m.id, m.business_name, m.wallet_address, m.cpay_id, m.category, m.description, m.logo_url, m.is_active
  FROM merchants m
  WHERE m.id = p_merchant_id AND m.is_active = TRUE;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION get_public_merchant_by_address(p_wallet_address TEXT)
RETURNS TABLE (
  id UUID,
  business_name TEXT,
  wallet_address TEXT,
  cpay_id TEXT,
  category TEXT,
  description TEXT,
  logo_url TEXT,
  is_active BOOLEAN
) AS $$
  SELECT m.id, m.business_name, m.wallet_address, m.cpay_id, m.category, m.description, m.logo_url, m.is_active
  FROM merchants m
  WHERE m.wallet_address = p_wallet_address AND m.is_active = TRUE;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION get_own_merchant_by_wallet(p_wallet_address TEXT)
RETURNS TABLE (
  id UUID,
  auth_user_id UUID,
  business_name TEXT,
  wallet_address TEXT,
  cpay_id TEXT,
  owner_name TEXT,
  email TEXT,
  phone_number TEXT,
  business_address TEXT,
  business_registration_number TEXT,
  description TEXT,
  category TEXT,
  logo_url TEXT,
  is_active BOOLEAN,
  verification_status TEXT,
  verified_contact_email TEXT,
  contact_email_verified BOOLEAN,
  submitted_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  total_transactions INTEGER,
  total_revenue NUMERIC,
  stellar_network TEXT,
  asset_code TEXT,
  asset_issuer TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
) AS $$
  SELECT
    m.id,
    m.auth_user_id,
    m.business_name,
    m.wallet_address,
    m.cpay_id,
    m.owner_name,
    m.email,
    m.phone_number,
    m.business_address,
    m.business_registration_number,
    m.description,
    m.category,
    m.logo_url,
    m.is_active,
    m.verification_status,
    m.verified_contact_email,
    m.contact_email_verified,
    m.submitted_at,
    m.reviewed_at,
    m.rejection_reason,
    m.total_transactions,
    m.total_revenue,
    m.stellar_network,
    m.asset_code,
    m.asset_issuer,
    m.created_at,
    m.updated_at
  FROM merchants m
  WHERE m.wallet_address = p_wallet_address
    AND (
      m.auth_user_id = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM users u
        WHERE u.auth_user_id = auth.uid()
          AND u.wallet_address = m.wallet_address
      )
    )
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- 9. Grants and RLS
ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_qr_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_contact_verifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "merchants_select_own" ON merchants;
CREATE POLICY "merchants_select_own" ON merchants
FOR SELECT USING (auth.uid() IS NOT NULL AND auth_user_id = auth.uid());

DROP POLICY IF EXISTS "merchants_insert_own" ON merchants;
CREATE POLICY "merchants_insert_own" ON merchants
FOR INSERT WITH CHECK (auth.uid() IS NOT NULL AND (auth_user_id IS NULL OR auth_user_id = auth.uid()));

DROP POLICY IF EXISTS "merchants_update_own" ON merchants;
CREATE POLICY "merchants_update_own" ON merchants
FOR UPDATE USING (auth.uid() IS NOT NULL AND auth_user_id = auth.uid())
WITH CHECK (auth.uid() IS NOT NULL AND auth_user_id = auth.uid());

DROP POLICY IF EXISTS "merchant_qr_codes_select_own" ON merchant_qr_codes;
CREATE POLICY "merchant_qr_codes_select_own" ON merchant_qr_codes
FOR SELECT USING (
  auth.uid() IS NOT NULL AND merchant_id IN (
    SELECT id FROM merchants WHERE auth_user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "merchant_qr_codes_manage_own" ON merchant_qr_codes;
CREATE POLICY "merchant_qr_codes_manage_own" ON merchant_qr_codes
FOR ALL USING (
  auth.uid() IS NOT NULL AND merchant_id IN (
    SELECT id FROM merchants WHERE auth_user_id = auth.uid()
  )
)
WITH CHECK (
  auth.uid() IS NOT NULL AND merchant_id IN (
    SELECT id FROM merchants WHERE auth_user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "transactions_select_participant" ON transactions;
CREATE POLICY "transactions_select_participant" ON transactions
FOR SELECT
USING (
  auth.uid() IS NOT NULL AND (
    from_address = current_wallet_address()
    OR to_address = current_wallet_address()
    OR merchant_id IN (
      SELECT id FROM merchants WHERE auth_user_id = auth.uid()
    )
  )
);

GRANT EXECUTE ON FUNCTION get_public_merchant_by_id(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_public_merchant_by_address(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_own_merchant_by_wallet(TEXT) TO authenticated;

COMMIT;
