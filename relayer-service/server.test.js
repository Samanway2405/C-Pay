/**
 * Ownership authorization tests for the C-Pay relayer.
 *
 * These tests verify that when auth is enabled the relayer:
 *   - Allows requests whose wallet belongs to the authenticated user.
 *   - Returns 403 WALLET_OWNERSHIP_DENIED when the wallet belongs to another user.
 *   - Returns 503 when an ownership lookup or binding write fails.
 *   - Refuses to boot when wallet_bindings is unavailable.
 *   - Skips ownership checks when auth is disabled (RELAYER_AUTH_REQUIRED=false).
 *
 * External network calls (Stellar Horizon, Supabase) are fully mocked so no real
 * credentials or network access are required.
 */

'use strict';

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Build a response object compatible with supabaseRestRequest and verifySupabaseTokenWithAuthApi.
 * supabaseRestRequest calls response.text() then JSON.parse().
 * verifySupabaseTokenWithAuthApi calls response.json().
 */
function makeResponse(ok, status, data) {
  const body = JSON.stringify(data);
  return {
    ok,
    status,
    text: async () => body,
    json: async () => data,
  };
}

/**
 * Build a minimal JWT-shaped Bearer token whose payload contains `sub`.
 * The signature is a placeholder; actual verification is mocked.
 */
function makeBearerToken(sub) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  return `Bearer ${header}.${payload}.sig`;
}

// ─── test wallets ────────────────────────────────────────────────────────────

// Real Ed25519 public keys so assertAccountId passes without mocking Stellar.
const WALLET_A = 'GAHT4QYQNAQIZQQ7AFCBULV5FDCZIXF6GVVK4PBVLM3H52UHLMIDLQQ';
const WALLET_B = 'GBJ3FIJHKQHC6LDLQZFNM3Y7DUJTKPBWT4SVBP4CJPVVYDCUYLPFV3S';

// Supabase user IDs.
const USER_A = 'user-a-uid';
const USER_B = 'user-b-uid';

// ─── mock fetch ──────────────────────────────────────────────────────────────

/**
 * The server uses the global `fetch` API for Supabase REST and Auth API calls.
 * We replace it with a controllable mock before the server module is loaded.
 *
 * Route table (called in order):
 *   /auth/v1/user      → verifySupabaseTokenWithAuthApi (sub from token header)
 *   /rest/v1/wallet_bindings?... → startup probe and ownership resolution
 */
function buildFetchMock({
  userWallets = {},
  walletOwners = {},
  failOwnershipLookup = false,
  failBindingWrite = false,
  walletBindingsUnavailable = false,
} = {}) {
  return async function mockFetch(url, options) {
    const urlStr = String(url);

    // ── Auth API ─────────────────────────────────────────────────────────────
    if (urlStr.includes('/auth/v1/user')) {
      const authHeader = (options && options.headers && options.headers['Authorization']) || '';
      const token = authHeader.replace(/^Bearer\s+/i, '');
      const [, encodedPayload] = token.split('.');
      let sub = null;
      try {
        sub = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString()).sub;
      } catch (_) { /* ignored */ }

      if (!sub) {
        return makeResponse(false, 401, { msg: 'Invalid token' });
      }
      return makeResponse(true, 200, { id: sub, aud: 'authenticated', role: 'authenticated' });
    }

    // ── wallet_bindings table ─────────────────────────────────────────────────
    if (urlStr.includes('/rest/v1/wallet_bindings')) {
      const parsed = new URL(urlStr);
      const method = (options && options.method) || 'GET';
      const authUserIdFilter = parsed.searchParams.get('auth_user_id') || '';
      const walletAddressFilter = parsed.searchParams.get('wallet_address') || '';
      const isStartupProbe = parsed.searchParams.get('select') === 'id'
        && parsed.searchParams.get('limit') === '1'
        && !authUserIdFilter
        && !walletAddressFilter;

      if (walletBindingsUnavailable) {
        return makeResponse(false, 404, { code: '42P01', message: 'relation "wallet_bindings" does not exist' });
      }
      if (isStartupProbe) {
        return makeResponse(true, 200, []);
      }
      if (method === 'POST') {
        if (failBindingWrite) {
          return makeResponse(false, 503, { code: 'PGRST000', message: 'database unavailable' });
        }
        return makeResponse(true, 201, null);
      }
      if (failOwnershipLookup) {
        return makeResponse(false, 503, { code: 'PGRST000', message: 'database unavailable' });
      }
      if (walletAddressFilter) {
        const wallet = walletAddressFilter.replace(/^eq\./, '');
        const owner = walletOwners[wallet];
        return makeResponse(true, 200, owner ? [{ auth_user_id: owner }] : []);
      }

      const uid = authUserIdFilter.replace(/^eq\./, '');
      const wallets = (userWallets[uid] || []).map(w => ({ wallet_address: w }));
      return makeResponse(true, 200, wallets);
    }

    // Fallback – should not be reached in these tests.
    return makeResponse(false, 500, { error: 'Unexpected fetch: ' + urlStr });
  };
}

// ─── load server ─────────────────────────────────────────────────────────────

let app;
let activeModuleServer = null;

/**
 * Reload the server module with specific environment variables.
 * Jest module isolation is used so each describe block can control env.
 */
async function loadServer(env = {}) {
  // Close the previous module-level server if any.
  if (activeModuleServer) {
    await new Promise((resolve) => {
      if (typeof activeModuleServer.closeAllConnections === 'function') {
        activeModuleServer.closeAllConnections();
      }
      activeModuleServer.close(resolve);
    }).catch(() => {});
    activeModuleServer = null;
  }

  // Reset module registry to pick up new env values.
  jest.resetModules();

  // Defaults that satisfy loadConfig() without real secrets.
  const defaultEnv = {
    STELLAR_NETWORK: 'testnet',
    ALLOW_HTTP_HORIZON: 'true',
    ALLOW_CUSTOM_HORIZON: 'true',
    STELLAR_HORIZON_URL: 'http://localhost:9999/horizon',
    ALLOW_HTTP_SOROBAN_RPC: 'true',
    ALLOW_CUSTOM_SOROBAN_RPC: 'true',
    SOROBAN_RPC_URL: 'http://localhost:9999/soroban',
    STELLAR_NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
    SPONSOR_SECRET: 'SCTIPFZ5KVBOENXTZK3FQPIGR5H73R5HE2MNZ4AXA7CA7JEEXUG5AF5G',
    DISTRIBUTION_SECRET: 'SBMJSD66AECV4CKZWTHXCH4EDZ5CRAZNNZL4OQP6IQAR4YLQ6HE5QJDM',
    USDC_ASSET_ISSUER: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    SUPABASE_URL: 'http://localhost:9999/supabase',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    RELAYER_AUTH_REQUIRED: 'true',
    ENABLE_TESTNET_FAUCET: 'true',
    LEDGER_INGEST_ENABLED: 'false',
    PORT: '0',
  };

  const { __fetchMock, ...envOverrides } = env;
  Object.assign(process.env, defaultEnv, envOverrides);

  // Mount our fetch mock onto the global so the module picks it up.
  const fetchImpl = __fetchMock || buildFetchMock();
  global.fetch = fetchImpl;

  const mod = require('./server.js');
  await mod.startupPromise;
  app = mod.app;
  activeModuleServer = mod.server;

  return app;
}

// ─── request helper ──────────────────────────────────────────────────────────

const http = require('http');

function postJson(appInstance, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const options = {
      method: 'POST',
      path,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...headers,
      },
    };

    const testServer = http.createServer(appInstance);
    testServer.listen(0, '127.0.0.1', () => {
      const port = testServer.address().port;
      const req = http.request({ ...options, host: '127.0.0.1', port }, (res) => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          testServer.close();
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch (_) {
            resolve({ status: res.statusCode, body: data });
          }
        });
      });
      req.on('error', (err) => { testServer.close(); reject(err); });
      req.write(payload);
      req.end();
    });
  });
}

function getJson(appInstance, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const testServer = http.createServer(appInstance);
    testServer.listen(0, '127.0.0.1', () => {
      const port = testServer.address().port;
      const req = http.request({
        method: 'GET',
        path,
        host: '127.0.0.1',
        port,
        headers,
      }, (res) => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          testServer.close();
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch (_) {
            resolve({ status: res.statusCode, body: data });
          }
        });
      });
      req.on('error', (error) => {
        testServer.close();
        reject(error);
      });
      req.end();
    });
  });
}

// ─── test suites ─────────────────────────────────────────────────────────────

afterEach(async () => {
  // Close the active module server to free the port.
  if (activeModuleServer) {
    await new Promise((resolve) => {
      if (typeof activeModuleServer.closeAllConnections === 'function') {
        activeModuleServer.closeAllConnections();
      }
      activeModuleServer.close(resolve);
    }).catch(() => {});
    activeModuleServer = null;
  }

  // Clean up env additions to avoid bleed between suites.
  const ADDED_KEYS = [
    'STELLAR_NETWORK', 'ALLOW_HTTP_HORIZON', 'ALLOW_CUSTOM_HORIZON',
    'STELLAR_HORIZON_URL', 'ALLOW_HTTP_SOROBAN_RPC', 'ALLOW_CUSTOM_SOROBAN_RPC',
    'SOROBAN_RPC_URL', 'STELLAR_NETWORK_PASSPHRASE', 'SPONSOR_SECRET',
    'DISTRIBUTION_SECRET', 'CPINR_ASSET_ISSUER', 'USDC_ASSET_ISSUER',
    'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_JWT_SECRET',
    'RELAYER_AUTH_REQUIRED', 'ENABLE_TESTNET_FAUCET', 'LEDGER_INGEST_ENABLED', 'PORT',
  ];
  ADDED_KEYS.forEach(k => delete process.env[k]);
  jest.resetModules();
});

// ── /accounts/prepare ────────────────────────────────────────────────────────

describe('/accounts/prepare ownership', () => {
  let expressApp;

  beforeEach(async () => {
    expressApp = await loadServer({
      __fetchMock: buildFetchMock({
        userWallets: { [USER_A]: [WALLET_A] },
        walletOwners: {
          [WALLET_A]: USER_A,
          [WALLET_B]: USER_B,
        },
      }),
    });
  });

  it('allows the authenticated owner to prepare their own account', async () => {
    // The Stellar Horizon call inside /accounts/prepare will fail (no real server),
    // but only after the ownership check passes. We verify status is NOT 403.
    const { status, body } = await postJson(
      expressApp,
      '/accounts/prepare',
      { accountId: WALLET_A },
      { Authorization: makeBearerToken(USER_A) }
    );

    expect(status).not.toBe(403);
    expect(body.code).not.toBe('WALLET_OWNERSHIP_DENIED');
  });

  it('blocks user A from preparing user B\'s account', async () => {
    const { status, body } = await postJson(
      expressApp,
      '/accounts/prepare',
      { accountId: WALLET_B },
      { Authorization: makeBearerToken(USER_A) }
    );

    expect(status).toBe(403);
    expect(body.code).toBe('WALLET_OWNERSHIP_DENIED');
  });

  it('aborts account sponsorship when a new wallet binding cannot be persisted', async () => {
    expressApp = await loadServer({
      __fetchMock: buildFetchMock({
        userWallets: { [USER_A]: [WALLET_A] },
        failBindingWrite: true,
      }),
    });

    const { status, body } = await postJson(
      expressApp,
      '/accounts/prepare',
      { accountId: WALLET_B },
      { Authorization: makeBearerToken(USER_A) }
    );

    expect(status).toBe(503);
    expect(body).toEqual(expect.objectContaining({
      code: 'WALLET_BINDING_FAILED',
      retryable: true,
    }));
  });
});

// ── /add-money ───────────────────────────────────────────────────────────────

describe('/add-money ownership', () => {
  let expressApp;

  beforeEach(async () => {
    expressApp = await loadServer({
      __fetchMock: buildFetchMock({
        userWallets: { [USER_A]: [WALLET_A] },
      }),
    });
  });

  it('allows add-money for the authenticated owner\'s wallet', async () => {
    const { status, body } = await postJson(
      expressApp,
      '/add-money',
      { accountId: WALLET_A },
      { Authorization: makeBearerToken(USER_A) }
    );

    // Ownership passes; downstream may fail for other reasons (Horizon unreachable),
    // but must not return 403 WALLET_OWNERSHIP_DENIED.
    expect(status).not.toBe(403);
    expect(body.code).not.toBe('WALLET_OWNERSHIP_DENIED');
  });

  it('blocks add-money for a wallet not owned by the authenticated user', async () => {
    const { status, body } = await postJson(
      expressApp,
      '/add-money',
      { accountId: WALLET_B },
      { Authorization: makeBearerToken(USER_A) }
    );

    expect(status).toBe(403);
    expect(body.code).toBe('WALLET_OWNERSHIP_DENIED');
  });
});

// ── auth disabled ─────────────────────────────────────────────────────────────

describe('ownership checks skipped when auth is disabled', () => {
  let expressApp;

  beforeEach(async () => {
    expressApp = await loadServer({
      RELAYER_AUTH_REQUIRED: 'false',
      SUPABASE_URL: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      __fetchMock: buildFetchMock({
        userWallets: {},
        merchantRows: {},
      }),
    });
  });

  it('does not return 403 for /add-money when auth is disabled', async () => {
    const { status, body } = await postJson(
      expressApp,
      '/add-money',
      { accountId: WALLET_B }
    );

    expect(status).not.toBe(403);
    expect(body.code).not.toBe('WALLET_OWNERSHIP_DENIED');
  });

  it('does not return 403 for /accounts/prepare when auth is disabled', async () => {
    const { status, body } = await postJson(
      expressApp,
      '/accounts/prepare',
      { accountId: WALLET_B }
    );

    expect(status).not.toBe(403);
    expect(body.code).not.toBe('WALLET_OWNERSHIP_DENIED');
  });
});

// ── fail-closed ownership infrastructure ─────────────────────────────────────

describe('ownership infrastructure failures', () => {
  it('rejects a request when the wallet binding lookup fails', async () => {
    const expressApp = await loadServer({
      __fetchMock: buildFetchMock({ failOwnershipLookup: true }),
    });

    const { status, body } = await postJson(
      expressApp,
      '/add-money',
      { accountId: WALLET_A },
      { Authorization: makeBearerToken(USER_A) }
    );

    expect(status).toBe(503);
    expect(body).toEqual(expect.objectContaining({
      code: 'WALLET_OWNERSHIP_UNAVAILABLE',
      retryable: true,
    }));
  });

  it('rejects a path-wallet request when the binding lookup fails', async () => {
    const expressApp = await loadServer({
      __fetchMock: buildFetchMock({ failOwnershipLookup: true }),
    });

    const { status, body } = await getJson(
      expressApp,
      `/account/${WALLET_A}/balance`,
      { Authorization: makeBearerToken(USER_A) }
    );

    expect(status).toBe(503);
    expect(body.code).toBe('WALLET_OWNERSHIP_UNAVAILABLE');
  });

  it('refuses to boot when wallet_bindings is unreachable', async () => {
    await expect(loadServer({
      __fetchMock: buildFetchMock({ walletBindingsUnavailable: true }),
    })).rejects.toThrow(/wallet_bindings/);
    expect(activeModuleServer).toBeNull();
  });

  it('refuses to boot without persistence when authentication is enabled', async () => {
    await expect(loadServer({
      RELAYER_AUTH_REQUIRED: 'true',
      SUPABASE_URL: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      SUPABASE_JWT_SECRET: 'test-jwt-secret-that-is-long-enough',
      __fetchMock: buildFetchMock({}),
    })).rejects.toThrow(/SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/);
    expect(activeModuleServer).toBeNull();
  });
});

// ── unauthenticated requests ──────────────────────────────────────────────────

describe('unauthenticated requests are rejected before ownership check', () => {
  let expressApp;

  beforeEach(async () => {
    expressApp = await loadServer({
      __fetchMock: buildFetchMock({
        userWallets: { [USER_A]: [WALLET_A] },
      }),
    });
  });

  it('returns 401 when no token is provided to /add-money', async () => {
    const { status, body } = await postJson(
      expressApp,
      '/add-money',
      { accountId: WALLET_A }
    );

    expect(status).toBe(401);
    expect(body.code).toBe('AUTH_REQUIRED');
  });

  it('returns 401 when no token is provided to /accounts/prepare', async () => {
    const { status, body } = await postJson(
      expressApp,
      '/accounts/prepare',
      { accountId: WALLET_A }
    );

    expect(status).toBe(401);
    expect(body.code).toBe('AUTH_REQUIRED');
  });
});
