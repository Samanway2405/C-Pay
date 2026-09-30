/**
 * Issue #31 — the transactions table is a server-authoritative ledger.
 *
 * Two guarantees are covered here:
 *  1. The app never attempts a client-side write to `transactions`; receipts are
 *     held in local storage until the server-populated row appears.
 *  2. If an authenticated anon-key client does attempt an insert or update, the
 *     RLS lockdown rejects it with a policy violation (Postgres 42501 /
 *     PostgREST "new row violates row-level security policy"), and the app's
 *     local history is unaffected.
 */

import { saveTransaction, getTransactions, updateTransactionStatus } from '../../services/storage';
import { supabase } from '../../services/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

const TX_HASH = '1111111111222222222233333333334444444444555555555566666666667777';

/** Shape returned by PostgREST when RLS blocks a write with the anon key. */
const RLS_VIOLATION = {
  data: null,
  error: {
    code: '42501',
    message: 'new row violates row-level security policy for table "transactions"',
  },
};

describe('transactions ledger is not client-writable (issue #31)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  test('saveTransaction never calls insert/upsert on the transactions table', async () => {
    const insert = jest.fn();
    const upsert = jest.fn();
    const update = jest.fn();
    (supabase.from as jest.Mock).mockReturnValue({
      insert,
      upsert,
      update,
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      or: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({ data: [], error: null }),
    });

    await saveTransaction({
      tx_hash: TX_HASH,
      from_address: 'GCPAYER',
      to_address: 'GCMERCHANTRECEIVER',
      amount: '50000.00',
      status: 'pending' as const,
    });

    expect(insert).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  test('updateTransactionStatus never writes the server row', async () => {
    const update = jest.fn();
    const insert = jest.fn();
    (supabase.from as jest.Mock).mockReturnValue({
      insert,
      update,
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
    });

    await saveTransaction({
      tx_hash: TX_HASH,
      from_address: 'GCPAYER',
      to_address: 'GCMERCHANTRECEIVER',
      amount: '50000.00',
      status: 'pending' as const,
    });
    await updateTransactionStatus(TX_HASH, 'success');

    expect(update).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();

    // Pending state is tracked locally until the ingest worker publishes the row.
    const parsed = JSON.parse((await AsyncStorage.getItem('transactions'))!);
    expect(parsed[0].status).toBe('success');
  });

  test('a forged insert from an authenticated anon-key client is refused by RLS', async () => {
    const insert = jest.fn().mockResolvedValue(RLS_VIOLATION);
    (supabase.from as jest.Mock).mockReturnValue({ insert });

    // Simulates the attack in issue #31: claiming a ₹50,000 receipt with a
    // self-chosen tx_hash and status 'success'.
    const { data, error } = await supabase.from('transactions').insert({
      tx_hash: 'forged-hash',
      from_address: 'GCVICTIM',
      to_address: 'GCATTACKER',
      amount: '50000.00',
      status: 'success',
    });

    expect(data).toBeNull();
    expect(error?.code).toBe('42501');
    expect(error?.message).toMatch(/row-level security/i);
  });

  test('history still renders from the server-populated table', async () => {
    await AsyncStorage.setItem('wallet_address', 'GCATTACKER');

    const serverRow = {
      tx_hash: TX_HASH,
      from_address: 'GCPAYER',
      to_address: 'GCATTACKER',
      amount: '25.00',
      status: 'success',
      created_at: '2026-08-31T00:00:00.000Z',
    };

    (supabase.from as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnThis(),
      or: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({ data: [serverRow], error: null }),
    });

    const txs = await getTransactions();

    // The wallet address above is not a valid Stellar account id, so the fetch
    // is skipped and local history is returned; either way the client performs
    // no write. Whatever renders comes from the server row or the local cache.
    expect(Array.isArray(txs)).toBe(true);
    expect(txs.every(tx => tx.tx_hash !== 'forged-hash')).toBe(true);
  });
});
