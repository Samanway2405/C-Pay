BEGIN;

SELECT plan(13);

SELECT has_table(
  'public',
  'transactions',
  'transactions exists after replaying the complete migration chain'
);

SELECT hasnt_table(
  'public',
  'merchants',
  'the retired merchants table is absent'
);

SELECT hasnt_column(
  'public',
  'transactions',
  'merchant_id',
  'transactions no longer contains merchant_id'
);

SELECT has_table(
  'public',
  'wallet_bindings',
  'wallet_bindings exists after a clean provision'
);

SELECT has_column(
  'public',
  'add_money_claims',
  'auth_user_id',
  'add_money_claims is keyed by authenticated user'
);

SELECT col_is_null(
  'public',
  'relayer_idempotency_keys',
  'response',
  'persisted relayer locks can store an in-flight NULL response'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('merchants', 'merchant_qr_codes', 'merchant_contact_verifications')
  ),
  'no merchant table survives a clean provision'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc
    JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
    WHERE pg_namespace.nspname = 'public'
      AND pg_proc.proname IN (
        'get_public_merchant_by_id',
        'get_public_merchant_by_address',
        'get_own_merchant_by_wallet',
        'refresh_merchant_totals',
        'update_merchant_totals_from_transaction'
      )
  ),
  'no merchant function survives a clean provision'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.transactions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%merchant%'
  ),
  'the transaction type CHECK no longer permits merchant values'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'transactions'
      AND policyname = 'transactions_select_participant'
      AND cmd = 'SELECT'
  ),
  'the participant SELECT policy exists'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'transactions'
      AND policyname = 'transactions_select_participant'
      AND qual ILIKE '%merchant%'
  ),
  'the participant SELECT policy references no merchant object'
);

SELECT ok(
  NOT has_table_privilege('anon', 'public.transactions', 'INSERT'),
  'the anon role cannot INSERT transactions'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.transactions', 'INSERT'),
  'an authenticated anon-key client cannot INSERT transactions'
);

SELECT * FROM finish();

ROLLBACK;
