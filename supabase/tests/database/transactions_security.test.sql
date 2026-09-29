BEGIN;

SELECT plan(7);

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
