'use strict';

const { IngestWorker, DEFAULT_CURSOR_KEY } = require('../ingestWorker');

function makeResponse(ok, status, data) {
  const body = JSON.stringify(data);
  return {
    ok,
    status,
    text: async () => body,
    json: async () => data,
  };
}

describe('IngestWorker', () => {
  const MOCK_SUPABASE_URL = 'https://mock.supabase.co';
  const MOCK_SERVICE_ROLE_KEY = 'mock-service-role-key';
  const MOCK_HORIZON_URL = 'https://horizon-testnet.stellar.org';

  let requests = [];
  let mockFetch;

  beforeEach(() => {
    requests = [];
    mockFetch = jest.fn(async (url, options = {}) => {
      const urlStr = String(url);
      const method = options.method || 'GET';
      const body = options.body ? JSON.parse(options.body) : null;
      requests.push({ url: urlStr, method, headers: options.headers, body });

      // Cursor loading
      if (urlStr.includes('/rest/v1/ingest_state')) {
        if (method === 'GET') {
          return makeResponse(true, 200, [{ key: DEFAULT_CURSOR_KEY, cursor: '12345-0', last_ledger: 100 }]);
        }
        return makeResponse(true, 200, { success: true });
      }

      // Wallet cache
      if (urlStr.includes('/rest/v1/users')) {
        return makeResponse(true, 200, [
          { id: 'user-1-uid', wallet_address: 'GAKNOWN_WALLET_1' },
          { id: 'user-2-uid', wallet_address: 'GAKNOWN_WALLET_2' },
        ]);
      }

      // Transactions
      if (urlStr.includes('/rest/v1/transactions')) {
        if (method === 'GET') {
          return makeResponse(true, 200, [
            { id: 'pending-tx-1', tx_hash: 'tx-hash-pending-1', submitted_at: '2026-08-28T00:00:00Z' },
          ]);
        }
        return makeResponse(true, 200, { success: true });
      }

      return makeResponse(true, 200, []);
    });
  });

  test('initializes and recovers cursor from Supabase storage', async () => {
    const worker = new IngestWorker({
      supabaseUrl: MOCK_SUPABASE_URL,
      supabaseServiceRoleKey: MOCK_SERVICE_ROLE_KEY,
      fetch: mockFetch,
    });

    await worker.initCursor();
    expect(worker.lastCursor).toBe('12345-0');
    expect(worker.lastIngestedLedger).toBe(100);
  });

  test('refreshes and caches known user wallets', async () => {
    const worker = new IngestWorker({
      supabaseUrl: MOCK_SUPABASE_URL,
      supabaseServiceRoleKey: MOCK_SERVICE_ROLE_KEY,
      fetch: mockFetch,
    });

    await worker.refreshWalletCache();
    expect(worker.walletUserCache.get('GAKNOWN_WALLET_1')).toBe('user-1-uid');
    expect(worker.walletUserCache.get('GAKNOWN_WALLET_2')).toBe('user-2-uid');
    expect(worker.walletUserCache.get('GAUNKNOWN_WALLET')).toBeUndefined();
  });

  test('processes payment operation and upserts transaction with matched user ID', async () => {
    const worker = new IngestWorker({
      supabaseUrl: MOCK_SUPABASE_URL,
      supabaseServiceRoleKey: MOCK_SERVICE_ROLE_KEY,
      fetch: mockFetch,
    });

    await worker.refreshWalletCache();

    const paymentOp = {
      id: 'op-101',
      type: 'payment',
      paging_token: '429496729600-1',
      transaction_hash: 'cpay-test-tx-hash-1',
      from: 'GAKNOWN_WALLET_1',
      to: 'GAUNKNOWN_WALLET',
      amount: '50.0000000',
      asset_type: 'credit_alphanum4',
      asset_code: 'USDC',
      asset_issuer: 'GCISSUER123',
      created_at: '2026-08-28T12:00:00Z',
    };

    await worker.processOperation(paymentOp);

    expect(worker.processedCount).toBe(1);
    expect(worker.lastCursor).toBe('429496729600-1');

    const txUpsertReq = requests.find(r => r.url.includes('/rest/v1/transactions') && r.method === 'POST');
    expect(txUpsertReq).toBeDefined();
    expect(txUpsertReq.body).toMatchObject({
      tx_hash: 'cpay-test-tx-hash-1',
      op_index: 1,
      transaction_type: 'personal',
      from_address: 'GAKNOWN_WALLET_1',
      to_address: 'GAUNKNOWN_WALLET',
      amount: '50.0000000',
      asset_code: 'USDC',
      asset_issuer: 'GCISSUER123',
      status: 'success',
      internal_status: 'confirmed',
      user_id: 'user-1-uid',
    });
  });

  test('handles unknown accounts with user_id = null', async () => {
    const worker = new IngestWorker({
      supabaseUrl: MOCK_SUPABASE_URL,
      supabaseServiceRoleKey: MOCK_SERVICE_ROLE_KEY,
      fetch: mockFetch,
    });

    await worker.refreshWalletCache();

    const paymentOp = {
      id: 'op-102',
      type: 'payment',
      paging_token: '429496729600-2',
      transaction_hash: 'cpay-test-tx-hash-2',
      from: 'GASTRANGER_1',
      to: 'GASTRANGER_2',
      amount: '10.0000000',
      asset_type: 'native',
      created_at: '2026-08-28T12:05:00Z',
    };

    await worker.processOperation(paymentOp);

    const txUpsertReq = requests.find(r => r.url.includes('/rest/v1/transactions') && r.body.tx_hash === 'cpay-test-tx-hash-2');
    expect(txUpsertReq).toBeDefined();
    expect(txUpsertReq.body.user_id).toBeNull();
    expect(txUpsertReq.body.asset_code).toBe('XLM');
  });

  test('calculates lag metrics accurately', () => {
    const worker = new IngestWorker({
      supabaseUrl: MOCK_SUPABASE_URL,
      supabaseServiceRoleKey: MOCK_SERVICE_ROLE_KEY,
    });

    worker.lastIngestedLedger = 1000;
    worker.latestNetworkLedger = 1005;
    worker.status = 'running';

    const lag = worker.getLag();
    expect(lag.ledgerLag).toBe(5);
    expect(lag.lastIngestedLedger).toBe(1000);
    expect(lag.latestNetworkLedger).toBe(1005);

    const health = worker.getHealth();
    expect(health.healthy).toBe(true);
    expect(health.lag).toBe(5);
  });

  test('reconciles pending transaction to success when confirmed on Horizon', async () => {
    const worker = new IngestWorker({
      supabaseUrl: MOCK_SUPABASE_URL,
      supabaseServiceRoleKey: MOCK_SERVICE_ROLE_KEY,
      fetch: mockFetch,
    });

    // Mock server.transactions().transaction()
    worker.server.transactions = () => ({
      transaction: (hash) => ({
        call: async () => ({
          id: hash,
          successful: true,
          created_at: '2026-08-28T00:01:00Z',
        }),
      }),
    });

    await worker.reconcilePendingTransactions();

    const patchReq = requests.find(r => r.url.includes('/rest/v1/transactions?id=eq.pending-tx-1') && r.method === 'PATCH');
    expect(patchReq).toBeDefined();
    expect(patchReq.body.status).toBe('success');
    expect(patchReq.body.internal_status).toBe('confirmed');
    expect(worker.reconciledCount).toBe(1);
  });

  test('reconciles timed-out transaction to failed when 404 on Horizon', async () => {
    const worker = new IngestWorker({
      supabaseUrl: MOCK_SUPABASE_URL,
      supabaseServiceRoleKey: MOCK_SERVICE_ROLE_KEY,
      fetch: mockFetch,
    });

    worker.server.transactions = () => ({
      transaction: () => ({
        call: async () => {
          const err = new Error('Not Found');
          err.response = { status: 404 };
          throw err;
        },
      }),
    });

    await worker.reconcilePendingTransactions();

    const patchReq = requests.find(r => r.url.includes('/rest/v1/transactions?id=eq.pending-tx-1') && r.method === 'PATCH');
    expect(patchReq).toBeDefined();
    expect(patchReq.body.status).toBe('failed');
    expect(patchReq.body.internal_status).toBe('failed');
    expect(patchReq.body.failure_reason).toContain('not found on chain');
  });
});

