-- Move configuration metadata to Circle USDC without rewriting historical
-- transaction rows. Old testnet asset balances remain on Stellar unchanged.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'cpinr_asset_code')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'asset_code') THEN
    ALTER TABLE users RENAME COLUMN cpinr_asset_code TO asset_code;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'cpinr_asset_issuer')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'asset_issuer') THEN
    ALTER TABLE users RENAME COLUMN cpinr_asset_issuer TO asset_issuer;
  END IF;
END $$;

ALTER TABLE users ALTER COLUMN asset_code SET DEFAULT 'USDC';
UPDATE users
SET asset_code = 'USDC',
    asset_issuer = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

ALTER TABLE transactions ALTER COLUMN asset_code SET DEFAULT 'USDC';
ALTER TABLE add_money_claims ALTER COLUMN asset_code SET DEFAULT 'USDC';
