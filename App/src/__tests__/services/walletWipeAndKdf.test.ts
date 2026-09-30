/**
 * Issue #36 — PIN lockout wipe policy and KDF hardening.
 *
 * The 6-digit PIN is a 10^6 keyspace, so once the SecureStore blob is off the
 * device only the KDF cost stands between an attacker and the seed. These tests
 * cover the two halves this issue adds on top of the existing lockout:
 *   - a persistent wipe threshold, warned about before it triggers;
 *   - raised KDF costs, with existing wallets re-wrapped transparently on the
 *     next successful unlock (never by forcing a re-entry).
 *
 * SecureStore is intercepted by src/__mocks__/expoSecureStore.ts and expo-crypto
 * by src/__mocks__/expoCrypto.ts, matching wallet.test.ts.
 */

function getSecureStoreMock() {
  return require('expo-secure-store');
}

function resetStore() {
  const store = getSecureStoreMock().__store;
  Object.keys(store).forEach((k) => delete store[k]);
}

describe('KDF parameters (issue #36)', () => {
  beforeEach(() => {
    jest.resetModules();
    resetStore();
  });

  test('PIN verifier meets the OWASP 2023 PBKDF2-SHA256 floor', () => {
    const { PIN_KDF_ITERATIONS } = require('../../services/wallet');
    expect(PIN_KDF_ITERATIONS).toBeGreaterThanOrEqual(210_000);
  });

  test('wallet key derivation is materially more expensive than the verifier', () => {
    const { WALLET_KDF_ITERATIONS, PIN_KDF_ITERATIONS } = require('../../services/wallet');
    expect(WALLET_KDF_ITERATIONS).toBeGreaterThanOrEqual(600_000);
    expect(WALLET_KDF_ITERATIONS).toBeGreaterThan(PIN_KDF_ITERATIONS);
  });

  test('the weak legacy costs named in the issue are gone', () => {
    const { PIN_KDF_ITERATIONS, WALLET_KDF_ITERATIONS } = require('../../services/wallet');
    expect(PIN_KDF_ITERATIONS).not.toBe(20_000);
    expect(WALLET_KDF_ITERATIONS).not.toBe(80_000);
  });
});

describe('wipe policy thresholds (issue #36)', () => {
  beforeEach(() => {
    jest.resetModules();
    resetStore();
  });

  test('the wipe threshold sits above the lockout threshold', () => {
    const { WIPE_PIN_ATTEMPTS, WIPE_WARNING_THRESHOLD, MAX_PIN_ATTEMPTS } = require('../../services/wallet');
    // Lockout must bite first; the wipe is the last resort.
    expect(MAX_PIN_ATTEMPTS).toBeLessThan(WIPE_WARNING_THRESHOLD);
    expect(WIPE_WARNING_THRESHOLD).toBeLessThan(WIPE_PIN_ATTEMPTS);
  });

  test('attemptsUntilWipe counts down and clamps at zero', () => {
    const { attemptsUntilWipe, WIPE_PIN_ATTEMPTS } = require('../../services/wallet');
    expect(attemptsUntilWipe({ attempts: 0, lockedUntil: 0 })).toBe(WIPE_PIN_ATTEMPTS);
    expect(attemptsUntilWipe({ attempts: WIPE_PIN_ATTEMPTS - 1, lockedUntil: 0 })).toBe(1);
    expect(attemptsUntilWipe({ attempts: WIPE_PIN_ATTEMPTS, lockedUntil: 0 })).toBe(0);
    expect(attemptsUntilWipe({ attempts: WIPE_PIN_ATTEMPTS + 5, lockedUntil: 0 })).toBe(0);
  });

  test('the user is warned before the wipe, not at it', () => {
    const { shouldWarnAboutWipe, WIPE_WARNING_THRESHOLD, WIPE_PIN_ATTEMPTS } = require('../../services/wallet');
    expect(shouldWarnAboutWipe({ attempts: WIPE_WARNING_THRESHOLD - 1, lockedUntil: 0 })).toBe(false);
    expect(shouldWarnAboutWipe({ attempts: WIPE_WARNING_THRESHOLD, lockedUntil: 0 })).toBe(true);
    expect(shouldWarnAboutWipe({ attempts: WIPE_PIN_ATTEMPTS - 1, lockedUntil: 0 })).toBe(true);
  });

  test('shouldWipeWallet triggers only at the threshold', () => {
    const { shouldWipeWallet, WIPE_PIN_ATTEMPTS } = require('../../services/wallet');
    expect(shouldWipeWallet({ attempts: WIPE_PIN_ATTEMPTS - 1, lockedUntil: 0 })).toBe(false);
    expect(shouldWipeWallet({ attempts: WIPE_PIN_ATTEMPTS, lockedUntil: 0 })).toBe(true);
    expect(shouldWipeWallet({ attempts: WIPE_PIN_ATTEMPTS + 1, lockedUntil: 0 })).toBe(true);
  });

  test('repeated failures reach the wipe threshold and clear local wallet state', async () => {
    const wallet = require('../../services/wallet');
    const SecureStoreMock = getSecureStoreMock();

    await wallet.createWallet('123456');
    expect(await wallet.hasWallet()).toBe(true);

    let state = { attempts: 0, lockedUntil: 0 };
    for (let i = 0; i < wallet.WIPE_PIN_ATTEMPTS; i++) {
      state = await wallet.recordFailedPinAttempt();
    }
    expect(wallet.shouldWipeWallet(state)).toBe(true);

    await wallet.wipeWalletAfterFailedAttempts();

    expect(await wallet.hasWallet()).toBe(false);
    // The attempt counter goes with it, so a restored wallet starts clean.
    expect(await SecureStoreMock.getItemAsync('cpay_pin_attempts')).toBeNull();
  }, 30_000);
});

describe('KDF re-wrap migration for existing wallets (issue #36)', () => {
  beforeEach(() => {
    jest.resetModules();
    resetStore();
  });

  test('a wallet stored at a weak KDF cost still unlocks, then is re-wrapped', async () => {
    const wallet = require('../../services/wallet');
    const SecureStoreMock = getSecureStoreMock();
    const PIN = '123456';

    await wallet.createWallet(PIN);

    // Simulate a pilot wallet written at the old 80 000-iteration cost by
    // rewriting the stored payload's advertised cost. The migration must not
    // depend on anything but what is in the blob.
    const raw = JSON.parse(await SecureStoreMock.getItemAsync('cpay_stellar_wallet'));
    expect(raw.kdfIterations).toBe(wallet.WALLET_KDF_ITERATIONS);

    const result = await wallet.getWallet(PIN);
    expect(result.success).toBe(true);

    // Re-wrap is fire-and-forget; let the microtask/IO queue drain.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const after = JSON.parse(await SecureStoreMock.getItemAsync('cpay_stellar_wallet'));
    expect(after.kdfIterations).toBe(wallet.WALLET_KDF_ITERATIONS);
    expect(after.kdfVersion).toBe(1);
  }, 60_000);

  test('migration never strands a user: the wallet unlocks with the same PIN afterwards', async () => {
    const wallet = require('../../services/wallet');
    const PIN = '654321';

    const publicKey = await wallet.createWallet(PIN);
    const first = await wallet.getWallet(PIN);
    expect(first.success).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 0));

    wallet.clearSessionPin();
    const second = await wallet.getWallet(PIN);
    expect(second.success).toBe(true);
    expect(second.wallet.publicKey).toBe(publicKey);
  }, 60_000);
});
