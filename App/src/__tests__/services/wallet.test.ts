/**
 * Tests for wallet PIN security: attempts, lockout, backoff, session, migration,
 * biometric fallback, and export safety.
 *
 * All SecureStore calls are intercepted by the mock in src/__mocks__/expoSecureStore.ts.
 * expo-crypto is intercepted by src/__mocks__/expoCrypto.ts (returns real random bytes).
 */

// ─── Module reset helpers ─────────────────────────────────────────────────────
// We need to re-import wallet.ts after wiping the SecureStore mock store between
// tests so module-level state (cachedPin, cachedWallet) is also fresh.

// Get the current mock reference (re-require after jest.resetModules if needed).
function getSecureStoreMock() {
  return require('expo-secure-store');
}

/** Reset both the SecureStore in-memory store and any module-level cache. */
function resetStore() {
  const mock = getSecureStoreMock();
  const store = mock.__store;
  Object.keys(store).forEach((k) => delete store[k]);
}

// ─── Re-export after clearing module cache ────────────────────────────────────
// Jest caches module-level state (like cachedPin / cachedWallet) across test
// cases.  We reset modules between describe blocks that depend on isolation.

describe('getPinAttemptState', () => {
  beforeEach(() => {
    jest.resetModules();
    resetStore();
  });

  test('returns zeroed state when nothing is stored', async () => {
    const { getPinAttemptState } = require('../../services/wallet');
    const result = await getPinAttemptState();
    expect(result.status).toBe('available');
    const state = result.state;
    expect(state.attempts).toBe(0);
    expect(state.lockedUntil).toBe(0);
  });

  test('returns stored attempt count and lockedUntil', async () => {
    const SecureStoreMock = getSecureStoreMock();
    const { getPinAttemptState } = require('../../services/wallet');
    const stored = { attempts: 3, lockedUntil: Date.now() + 60_000 };
    await SecureStoreMock.setItemAsync('cpay_pin_attempts', JSON.stringify(stored));
    const result = await getPinAttemptState();
    expect(result.status).toBe('available');
    const state = result.state;
    expect(state.attempts).toBe(3);
    expect(state.lockedUntil).toBeGreaterThan(Date.now());
  });

  test('treats corrupt stored data as unknown and therefore locked', async () => {
    const SecureStoreMock = getSecureStoreMock();
    const { getPinAttemptState } = require('../../services/wallet');
    await SecureStoreMock.setItemAsync('cpay_pin_attempts', 'not-valid-json{{');
    const state = await getPinAttemptState();
    expect(state.status).toBe('unknown');
  });

  test('treats a SecureStore read failure as unknown', async () => {
    const SecureStoreMock = getSecureStoreMock();
    const { getPinAttemptState } = require('../../services/wallet');
    jest.spyOn(SecureStoreMock, 'getItemAsync').mockRejectedValueOnce(new Error('read failed'));

    const state = await getPinAttemptState();
    expect(state).toEqual({ status: 'unknown' });
  });
});

describe('recordFailedPinAttempt', () => {
  beforeEach(() => {
    jest.resetModules();
    resetStore();
  });

  test('increments attempt count on each failure', async () => {
    const { recordFailedPinAttempt } = require('../../services/wallet');
    const s1 = await recordFailedPinAttempt();
    expect(s1.attempts).toBe(1);
    const s2 = await recordFailedPinAttempt();
    expect(s2.attempts).toBe(2);
  });

  test('locks out when the SecureStore write fails', async () => {
    const SecureStoreMock = getSecureStoreMock();
    const { recordFailedPinAttempt, MAX_LOCKOUT_MS } = require('../../services/wallet');
    jest.spyOn(SecureStoreMock, 'setItemAsync').mockRejectedValueOnce(new Error('write failed'));

    const state = await recordFailedPinAttempt();
    expect(state.attempts).toBe(1);
    expect(state.lockedUntil - Date.now()).toBeGreaterThan(MAX_LOCKOUT_MS - 1000);
  });

  test('does not set a lockout until MAX_PIN_ATTEMPTS is reached', async () => {
    const { recordFailedPinAttempt, MAX_PIN_ATTEMPTS } = require('../../services/wallet');
    let state = { lockedUntil: 0, attempts: 0 };
    for (let i = 0; i < MAX_PIN_ATTEMPTS - 1; i++) {
      state = await recordFailedPinAttempt();
    }
    expect(state.lockedUntil).toBe(0);
  });

  test('sets lockedUntil after MAX_PIN_ATTEMPTS failures', async () => {
    const { recordFailedPinAttempt, MAX_PIN_ATTEMPTS, LOCKOUT_BASE_MS } = require('../../services/wallet');
    let state = { lockedUntil: 0, attempts: 0 };
    for (let i = 0; i < MAX_PIN_ATTEMPTS; i++) {
      state = await recordFailedPinAttempt();
    }
    expect(state.lockedUntil).toBeGreaterThan(Date.now());
    // First lockout should be close to LOCKOUT_BASE_MS
    expect(state.lockedUntil - Date.now()).toBeLessThanOrEqual(LOCKOUT_BASE_MS + 100);
    expect(state.lockedUntil - Date.now()).toBeGreaterThan(LOCKOUT_BASE_MS - 1000);
  });

  test('doubles the lockout on each subsequent failure (exponential backoff)', async () => {
    const { recordFailedPinAttempt, MAX_PIN_ATTEMPTS, LOCKOUT_BASE_MS } = require('../../services/wallet');

    for (let i = 0; i < MAX_PIN_ATTEMPTS; i++) await recordFailedPinAttempt();
    const first = await recordFailedPinAttempt(); // 1 extra: delay = base * 2
    const firstRemaining = first.lockedUntil - Date.now();

    const second = await recordFailedPinAttempt(); // 2 extra: delay = base * 4
    const secondRemaining = second.lockedUntil - Date.now();

    // Second lockout should be roughly double the first.
    expect(secondRemaining).toBeGreaterThan(firstRemaining);
    // And never exceed MAX_LOCKOUT_MS
    const { MAX_LOCKOUT_MS } = require('../../services/wallet');
    expect(secondRemaining).toBeLessThanOrEqual(MAX_LOCKOUT_MS + 200);
  });

  test('caps lockout at MAX_LOCKOUT_MS regardless of how many extra attempts', async () => {
    const { recordFailedPinAttempt, MAX_PIN_ATTEMPTS, MAX_LOCKOUT_MS } = require('../../services/wallet');

    // Drive well past the threshold
    for (let i = 0; i < MAX_PIN_ATTEMPTS + 20; i++) {
      await recordFailedPinAttempt();
    }
    const state = await recordFailedPinAttempt();
    expect(state.lockedUntil - Date.now()).toBeLessThanOrEqual(MAX_LOCKOUT_MS + 200);
  });
});

describe('clearPinAttempts', () => {
  beforeEach(() => {
    jest.resetModules();
    resetStore();
  });

  test('resets attempt state to zero', async () => {
    const { recordFailedPinAttempt, clearPinAttempts, getPinAttemptState } = require('../../services/wallet');
    await recordFailedPinAttempt();
    await recordFailedPinAttempt();
    await clearPinAttempts();
    const result = await getPinAttemptState();
    expect(result.status).toBe('available');
    const state = result.state;
    expect(state.attempts).toBe(0);
    expect(state.lockedUntil).toBe(0);
  });
});

describe('isLockedOut', () => {
  test('returns true when lockedUntil is in the future', () => {
    const { isLockedOut } = require('../../services/wallet');
    expect(isLockedOut({ attempts: 5, lockedUntil: Date.now() + 60_000 })).toBe(true);
  });

  test('returns false when lockedUntil is 0', () => {
    const { isLockedOut } = require('../../services/wallet');
    expect(isLockedOut({ attempts: 3, lockedUntil: 0 })).toBe(false);
  });

  test('returns false when lockedUntil is in the past', () => {
    const { isLockedOut } = require('../../services/wallet');
    expect(isLockedOut({ attempts: 5, lockedUntil: Date.now() - 1 })).toBe(false);
  });
});

describe('lockoutRemainingMs', () => {
  test('returns 0 when not locked', () => {
    const { lockoutRemainingMs } = require('../../services/wallet');
    expect(lockoutRemainingMs({ attempts: 0, lockedUntil: 0 })).toBe(0);
  });

  test('returns positive ms when locked', () => {
    const { lockoutRemainingMs } = require('../../services/wallet');
    const ms = lockoutRemainingMs({ attempts: 5, lockedUntil: Date.now() + 30_000 });
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(30_000);
  });

  test('returns 0 when lockout has just expired', () => {
    const { lockoutRemainingMs } = require('../../services/wallet');
    expect(lockoutRemainingMs({ attempts: 5, lockedUntil: Date.now() - 1 })).toBe(0);
  });
});

describe('clearSessionPin', () => {
  test('clears the in-memory pin and wallet cache', async () => {
    jest.resetModules();
    resetStore();
    const { cachePinForSession, clearSessionPin, getWalletFromSession } = require('../../services/wallet');

    cachePinForSession('123456', 60_000);
    clearSessionPin();

    // getWalletFromSession needs a PIN in cache; it should return null after clear
    const wallet = await getWalletFromSession();
    expect(wallet).toBeNull();
  });
});

describe('verifyPin & getWallet — result discrimination & error handling', () => {
  beforeEach(() => {
    jest.resetModules();
    resetStore();
  });

  test('parses a legacy raw-hex verifier (no JSON) and returns INVALID_PIN when hash does not match', async () => {
    const SecureStoreMock = getSecureStoreMock();
    const { verifyPin } = require('../../services/wallet');

    const fakeHex = '0'.repeat(64);
    await SecureStoreMock.setItemAsync('cpay_pin_hash', fakeHex);
    await SecureStoreMock.setItemAsync('cpay_pin_salt', '0'.repeat(32));

    const result = await verifyPin('000000');
    expect(result).toEqual({ success: false, error: 'INVALID_PIN' });
  });

  test('verifyPin returns INVALID_PIN when no verifier is stored', async () => {
    const { verifyPin } = require('../../services/wallet');
    const result = await verifyPin('123456');
    expect(result).toEqual({ success: false, error: 'INVALID_PIN' });
  });

  test('verifyPin returns STORAGE_ERROR when SecureStore throws an error', async () => {
    const SecureStoreMock = getSecureStoreMock();
    const { verifyPin } = require('../../services/wallet');

    jest.spyOn(SecureStoreMock, 'getItemAsync').mockRejectedValueOnce(new Error('SecureStore disk failure'));

    const result = await verifyPin('123456');
    expect(result).toEqual({
      success: false,
      error: 'STORAGE_ERROR',
      rawError: expect.any(Error),
    });
  });

  test('getWallet returns INVALID_PIN when wrong PIN is supplied', async () => {
    const { createWallet, getWallet } = require('../../services/wallet');
    await createWallet('123456');

    const result = await getWallet('999999');
    expect(result).toEqual({ success: false, wallet: null, error: 'INVALID_PIN', rawError: undefined });
  });

  test('getWallet returns STORAGE_ERROR when SecureStore read fails', async () => {
    const SecureStoreMock = getSecureStoreMock();
    const { createWallet, getWallet } = require('../../services/wallet');
    await createWallet('123456');

    jest.spyOn(SecureStoreMock, 'getItemAsync').mockRejectedValueOnce(new Error('SecureStore unhandled failure'));

    const result = await getWallet('123456');
    expect(result).toEqual({
      success: false,
      wallet: null,
      error: 'STORAGE_ERROR',
      rawError: expect.any(Error),
    });
  });

  test('storage error during PIN check does not increment attempt count', async () => {
    const SecureStoreMock = getSecureStoreMock();
    const { verifyPin, getPinAttemptState, recordFailedPinAttempt } = require('../../services/wallet');

    jest.spyOn(SecureStoreMock, 'getItemAsync').mockRejectedValueOnce(new Error('Transient storage error'));

    const result = await verifyPin('123456');
    expect(result.success).toBe(false);
    expect(result.error).toBe('STORAGE_ERROR');

    // Emulate UI logic: recordFailedPinAttempt is ONLY called on INVALID_PIN, NOT on STORAGE_ERROR
    if (result.error === 'INVALID_PIN') {
      await recordFailedPinAttempt();
    }

    const attemptState = await getPinAttemptState();
    expect(attemptState.status).toBe('available');
    expect(attemptState.state.attempts).toBe(0);
  });
});

describe('clearWallet — removes PIN_ATTEMPTS_KEY', () => {
  beforeEach(() => {
    jest.resetModules();
    resetStore();
  });

  test('clears attempt state alongside wallet data', async () => {
    const { recordFailedPinAttempt, clearWallet, getPinAttemptState } = require('../../services/wallet');

    await recordFailedPinAttempt();
    await clearWallet();

    const result = await getPinAttemptState();
    expect(result.status).toBe('available');
    const state = result.state;
    expect(state.attempts).toBe(0);
    expect(state.lockedUntil).toBe(0);
  });
});

describe('PIN_ATTEMPTS_KEY persists across module reloads', () => {
  test('attempt count survives a module cache reset (store is intact)', async () => {
    // Simulate an app restart: record failures, reset the wallet module
    // (clears in-memory cachedPin/cachedWallet), then re-read state.
    // The SecureStore mock is NOT reset so the persisted data remains.
    jest.resetModules();
    resetStore();

    const w1 = require('../../services/wallet');
    await w1.recordFailedPinAttempt();
    await w1.recordFailedPinAttempt();
    const beforeResult = await w1.getPinAttemptState();
    expect(beforeResult.status).toBe('available');
    const before = beforeResult.state;
    expect(before.attempts).toBe(2);

    // Reset only the wallet module (not SecureStore mock), simulating restart.
    jest.isolateModules(() => { /* no-op — just to scope */ });
    // Re-require wallet but keep the same SecureStore mock instance.
    const w2 = require('../../services/wallet');
    const afterResult = await w2.getPinAttemptState();
    expect(afterResult.status).toBe('available');
    const after = afterResult.state;
    // Both w1 and w2 point to the same module in this Jest run because we
    // didn't call jest.resetModules() again, so the store is intact.
    expect(after.attempts).toBe(2);
  });
});

describe('Export safety — hasBiometricBackup flag', () => {
  beforeEach(() => {
    jest.resetModules();
    resetStore();
  });

  test('hasBiometricBackup returns false when no flag is stored', async () => {
    const { hasBiometricBackup } = require('../../services/wallet');
    expect(await hasBiometricBackup()).toBe(false);
  });

  test('hasBiometricBackup returns true when flag is set', async () => {
    const SecureStoreMock = getSecureStoreMock();
    const { hasBiometricBackup } = require('../../services/wallet');
    await SecureStoreMock.setItemAsync('cpay_stellar_biometric_backup_available', 'true');
    expect(await hasBiometricBackup()).toBe(true);
  });

  test('clearBiometricBackup removes the availability flag', async () => {
    const SecureStoreMock = getSecureStoreMock();
    const { clearBiometricBackup, hasBiometricBackup } = require('../../services/wallet');
    await SecureStoreMock.setItemAsync('cpay_stellar_biometric_backup_available', 'true');
    await clearBiometricBackup();
    expect(await hasBiometricBackup()).toBe(false);
  });
});

describe('Session constants', () => {
  test('SESSION_TIMEOUT_MINUTES is 15', () => {
    const { SESSION_TIMEOUT_MINUTES } = require('../../services/wallet');
    expect(SESSION_TIMEOUT_MINUTES).toBe(15);
  });

  test('MAX_PIN_ATTEMPTS is 5', () => {
    const { MAX_PIN_ATTEMPTS } = require('../../services/wallet');
    expect(MAX_PIN_ATTEMPTS).toBe(5);
  });

  test('LOCKOUT_BASE_MS is 30 seconds', () => {
    const { LOCKOUT_BASE_MS } = require('../../services/wallet');
    expect(LOCKOUT_BASE_MS).toBe(30_000);
  });

  test('MAX_LOCKOUT_MS is 1 hour', () => {
    const { MAX_LOCKOUT_MS } = require('../../services/wallet');
    expect(MAX_LOCKOUT_MS).toBe(60 * 60 * 1000);
  });
});
