import { Logger } from '../utils/logger';
/**
 * @file wallet.ts
 * @description Local Stellar wallet: key generation, PIN-based encryption,
 *   biometric backup, session caching, and PIN lockout / backoff.
 *
 * ─── Security design notes ───────────────────────────────────────────────────
 *
 * Threat model for the PIN  (issue #36)
 *   A 6-digit PIN is a 10^6 keyspace — small enough that, once an attacker has
 *   the SecureStore blob off the device, only the KDF cost stands between them
 *   and the seed.  The lockout policy below is worthless in that scenario: it
 *   is enforced by this app, and an offline attacker is not running this app.
 *   So the PIN is treated as a *convenience factor* guarding an on-device
 *   secret, and defence is layered:
 *     1. Lockout + wipe raise the cost of on-device guessing.
 *     2. KDF cost raises the cost of offline guessing once extracted.
 *     3. SecureStore keeps the blob in the platform keystore to begin with.
 *   Even so, 10^6 × PBKDF2 remains tractable for a motivated attacker with
 *   GPUs.  A memory-hard KDF (Argon2id) is the real fix — see the note on
 *   WALLET_KDF_ITERATIONS below.
 *
 * PIN verifier KDF  (PIN_KDF_ITERATIONS = 210 000)
 *   PBKDF2-SHA256 over the salted PIN, used only to verify the PIN at login.
 *   Set to the OWASP 2023 floor for PBKDF2-SHA256.  This runs once per login
 *   attempt; at ~200 ms on target hardware that is acceptable interactively
 *   and multiplies an offline attacker's cost over the whole 10^6 keyspace.
 *   Verifiers written at the old 20 000 (and the older legacy 120 000) are
 *   migrated transparently on the next successful login — never by forcing a
 *   re-entry, which could strand a user who has no cloud backup.
 *
 * Wallet encryption KDF  (WALLET_KDF_ITERATIONS = 600 000)
 *   PBKDF2-SHA256 over the salted PIN, used to derive the key for wallet
 *   encryption.  Higher than the verifier because it is only called on a
 *   successful unlock — the cost is paid once per session, not per attempt.
 *   Existing wallets are re-wrapped at the new cost on the next successful
 *   unlock (see maybeRewrapWalletSecret), so no user is ever asked to
 *   re-enter or re-import anything.
 *
 *   NOTE: PBKDF2 is not memory-hard, so GPU parallelism still favours the
 *   attacker.  Argon2id is the intended replacement; it is not adopted here
 *   because the pinned @noble/hashes is 1.3.2, which predates Argon2 support
 *   (added in 1.4).  The versioned re-wrap path below is what makes that swap
 *   a contained change: bump WALLET_KDF_VERSION and implement deriveWalletKey
 *   for the new version, and existing wallets migrate themselves on unlock.
 *
 * Wallet cipher  (XChaCha20-Poly1305)
 *   Chosen over AES-GCM for its larger 192-bit nonce (eliminates nonce-reuse
 *   risk) and constant-time software implementation via @noble/ciphers.
 *
 * Session cache  (SESSION_PIN_TTL_MS = 15 min)
 *   The decrypted wallet and the PIN are held in module-level variables after
 *   a successful unlock.  They expire after 15 minutes of non-use and are
 *   explicitly cleared when the app goes to background (see App.tsx) or the
 *   user signs out.  The raw PIN is cached (not only the hash) so that
 *   wallet signing calls inside the session TTL do not require re-entry.
 *
 * PIN lockout policy  (MAX_PIN_ATTEMPTS = 5, LOCKOUT_BASE_MS = 30 000)
 *   After 5 consecutive wrong PINs the account enters a timed lockout.
 *   Each subsequent wrong attempt doubles the base delay (exponential
 *   backoff) up to MAX_LOCKOUT_MS = 1 hour.  The attempt counter and
 *   lockout-until timestamp are written to SecureStore so they survive
 *   app restarts and cannot be reset by simply force-quitting the app.
 *   A successful PIN clears the counter.
 *
 * Local wipe policy  (WIPE_PIN_ATTEMPTS = 15)
 *   After 15 consecutive wrong PINs the encrypted wallet is erased from this
 *   device.  This bounds on-device guessing at 15 tries out of 10^6 rather
 *   than letting an attacker sit through the backoff indefinitely.
 *
 *   The wipe destroys ONLY local device state.  It does not touch the Stellar
 *   account or the encrypted cloud backup, so a user with a cloud backup and
 *   their recovery password loses nothing but the need to restore.  A user
 *   WITHOUT a cloud backup loses the wallet permanently — there is no other
 *   copy of the seed.  Because of that asymmetry the UI must warn before the
 *   threshold is reached, not at it: attemptsUntilWipe() drives a countdown
 *   from WIPE_WARNING_THRESHOLD onward, and LoginScreen surfaces it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import * as StellarSdk from '@stellar/stellar-base';
import { Buffer } from 'buffer';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { bytesToHex, hexToBytes, utf8ToBytes, bytesToUtf8 } from '@noble/ciphers/utils';
import { pbkdf2Async } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';

// ─── SecureStore keys ─────────────────────────────────────────────────────────
const WALLET_KEY = 'cpay_stellar_wallet';
const PIN_KEY = 'cpay_pin_hash';
const SALT_KEY = 'cpay_pin_salt';
const BIOMETRIC_BACKUP_KEY = 'cpay_stellar_biometric_backup';
const BIOMETRIC_BACKUP_AVAILABLE_KEY = 'cpay_stellar_biometric_backup_available';
/** Persisted PIN attempt state: { attempts, lockedUntil } */
const PIN_ATTEMPTS_KEY = 'cpay_pin_attempts';
/** Pending values make PIN changes recoverable if the app is killed mid-write. */
const PENDING_WALLET_KEY = `${WALLET_KEY}_pending`;
const PENDING_PIN_KEY = `${PIN_KEY}_pending`;
const PENDING_SALT_KEY = `${SALT_KEY}_pending`;

// ─── Versioning & KDF constants ───────────────────────────────────────────────
const WALLET_STORAGE_VERSION = 4;
const PIN_VERIFIER_VERSION = 2;
/** Legacy PBKDF2 iterations used before v2 verifiers. Migrated on next login. */
const LEGACY_PIN_KDF_ITERATIONS = 120_000;
/**
 * PBKDF2-SHA256 iterations for the PIN *verifier* (login check).
 * OWASP 2023 floor for PBKDF2-SHA256. Raised from 20 000 (issue #36).
 */
export const PIN_KDF_ITERATIONS = 210_000;
/**
 * PBKDF2-SHA256 iterations for *wallet* key derivation (paid once per session).
 * Raised from 80 000 (issue #36).
 */
export const WALLET_KDF_ITERATIONS = 600_000;
/**
 * Identifies the wallet key-derivation scheme. Bump when the KDF itself
 * changes (e.g. to Argon2id) so stored wallets can be re-wrapped on unlock.
 */
const WALLET_KDF_VERSION = 1;

// ─── Session TTL ──────────────────────────────────────────────────────────────
/** Wallet and PIN stay in memory for this many milliseconds after last use. */
const SESSION_PIN_TTL_MS = 15 * 60 * 1000;
/** Exported for display in the Security Centre screen. */
export const SESSION_TIMEOUT_MINUTES = Math.round(SESSION_PIN_TTL_MS / 60_000);

// ─── Lockout policy ───────────────────────────────────────────────────────────
/** Wrong PINs allowed before the first lockout is imposed. */
export const MAX_PIN_ATTEMPTS = 5;
/** Base lockout duration in ms. Doubles on each subsequent wrong attempt. */
export const LOCKOUT_BASE_MS = 30_000; // 30 seconds
/** Hard ceiling for any single lockout period. */
export const MAX_LOCKOUT_MS = 60 * 60 * 1000; // 1 hour
/** Fixed lockout duration used when SecureStore cannot be trusted. */
const STORAGE_FAILURE_LOCKOUT_MS = MAX_LOCKOUT_MS;

// ─── Local wipe policy ────────────────────────────────────────────────────────
/**
 * Consecutive wrong PINs after which the local wallet is erased.
 * See the "Local wipe policy" note at the top of this file.
 */
export const WIPE_PIN_ATTEMPTS = 15;
/**
 * Start warning the user about the impending wipe from this attempt onward,
 * so the wipe is never a surprise.
 */
export const WIPE_WARNING_THRESHOLD = 10;

// ─── Types ────────────────────────────────────────────────────────────────────

type StoredWalletPayload = {
  version: 4;
  publicKey: string;
  cipher: 'xchacha20-poly1305';
  kdf: 'pbkdf2-sha256';
  kdfIterations: number;
  /**
   * Key-derivation scheme version (issue #36). Absent on wallets written
   * before the re-wrap migration existed; treated as 1.
   */
  kdfVersion?: number;
  salt: string;
  nonce: string;
  ciphertext: string;
  updatedAt: string;
};

type StoredBiometricPayload = {
  version: 1;
  publicKey: string;
  secret: string;
  updatedAt: string;
};

type StoredPinVerifierPayload = {
  version: 2;
  kdf: 'pbkdf2-sha256';
  kdfIterations: number;
  hash: string;
  updatedAt: string;
};

type CachedPin = {
  pin: string;
  expiresAt: number;
};

type CachedWallet = {
  wallet: StellarWallet;
  expiresAt: number;
};

/** Persisted attempt state written to SecureStore. */
export type PinAttemptState = {
  /** Total consecutive wrong attempts since last success. */
  attempts: number;
  /** Timestamp (ms) when the current lockout ends; 0 if not locked. */
  lockedUntil: number;
};

export type StellarWallet = {
  address: string;
  publicKey: string;
  secret: string;
  keypair: StellarSdk.Keypair;
  signXdr: (xdr: string, networkPassphrase: string) => string;
};

type VerifyPinOptions = {
  migrate?: boolean;
  blockMigration?: boolean;
};

export type WalletOperationError = 'INVALID_PIN' | 'STORAGE_ERROR';

export type VerifyPinResult =
  | { success: true }
  | { success: false; error: WalletOperationError; rawError?: unknown };

export type GetWalletResult =
  | { success: true; wallet: StellarWallet }
  | { success: false; wallet: null; error: WalletOperationError; rawError?: unknown };

export type PinAttemptStateResult =
  | { status: 'available'; state: PinAttemptState }
  | { status: 'unknown' };

// ─── In-memory session state ──────────────────────────────────────────────────

let cachedPinHash: string | null = null;
let cachedPin: CachedPin | null = null;
let cachedWallet: CachedWallet | null = null;

// ─── Session helpers ──────────────────────────────────────────────────────────

export function cachePinForSession(pin: string, ttlMs: number = SESSION_PIN_TTL_MS): void {
  cachedPin = { pin, expiresAt: Date.now() + ttlMs };
}

export function clearSessionPin(): void {
  cachedPin = null;
  cachedWallet = null;
}

function getCachedPin(): string | null {
  if (!cachedPin) return null;
  if (Date.now() >= cachedPin.expiresAt) {
    cachedPin = null;
    return null;
  }
  return cachedPin.pin;
}

// ─── Lockout / attempt tracking ───────────────────────────────────────────────

/**
 * Read the current PIN attempt state from SecureStore.
 * Returns an available zeroed state if nothing is stored yet.
 */
export async function getPinAttemptState(): Promise<PinAttemptStateResult> {
  try {
    const raw = await SecureStore.getItemAsync(PIN_ATTEMPTS_KEY);
    if (!raw) return { status: 'available', state: { attempts: 0, lockedUntil: 0 } };
    const parsed = JSON.parse(raw) as Partial<PinAttemptState>;
    if (typeof parsed.attempts !== 'number' || typeof parsed.lockedUntil !== 'number') {
      return { status: 'unknown' };
    }
    return { status: 'available', state: { attempts: parsed.attempts, lockedUntil: parsed.lockedUntil } };
  } catch {
    return { status: 'unknown' };
  }
}

/**
 * Record a failed PIN attempt.  Computes and persists the next lockout window
 * using exponential backoff.  Returns the updated state.
 */
export async function recordFailedPinAttempt(): Promise<PinAttemptState> {
  const current = await getPinAttemptState();
  const attempts = current.status === 'available' ? current.state.attempts + 1 : 0;

  let lockedUntil = current.status === 'unknown' ? Date.now() + STORAGE_FAILURE_LOCKOUT_MS : 0;
  if (current.status === 'available' && attempts >= MAX_PIN_ATTEMPTS) {
    // Extra attempts beyond the threshold double the delay each time.
    const extraAttempts = attempts - MAX_PIN_ATTEMPTS;
    const delay = Math.min(LOCKOUT_BASE_MS * Math.pow(2, extraAttempts), MAX_LOCKOUT_MS);
    lockedUntil = Date.now() + delay;
  }

  const next: PinAttemptState = { attempts, lockedUntil };
  try {
    await SecureStore.setItemAsync(PIN_ATTEMPTS_KEY, JSON.stringify(next));
  } catch {
    return { attempts, lockedUntil: Date.now() + STORAGE_FAILURE_LOCKOUT_MS };
  }
  return next;
}

/**
 * Clear the attempt counter after a successful PIN verification.
 */
export async function clearPinAttempts(): Promise<void> {
  await SecureStore.deleteItemAsync(PIN_ATTEMPTS_KEY);
}

/**
 * Returns true when the user is currently locked out (lockedUntil > now).
 */
export function isLockedOut(state: PinAttemptState): boolean {
  return state.lockedUntil > Date.now();
}

/**
 * Milliseconds remaining in the current lockout (0 if not locked).
 */
export function lockoutRemainingMs(state: PinAttemptState): number {
  if (!isLockedOut(state)) return 0;
  return state.lockedUntil - Date.now();
}

/**
 * Wrong attempts left before the local wallet is wiped.
 * Clamped at 0; never negative.
 */
export function attemptsUntilWipe(state: PinAttemptState): number {
  return Math.max(0, WIPE_PIN_ATTEMPTS - state.attempts);
}

/**
 * True once the user should be warned that continued wrong PINs will erase
 * the wallet from this device.
 */
export function shouldWarnAboutWipe(state: PinAttemptState): boolean {
  return state.attempts >= WIPE_WARNING_THRESHOLD && state.attempts < WIPE_PIN_ATTEMPTS;
}

/**
 * True when the wipe threshold has been reached and the local wallet must go.
 */
export function shouldWipeWallet(state: PinAttemptState): boolean {
  return state.attempts >= WIPE_PIN_ATTEMPTS;
}

/**
 * Erase the local wallet after too many failed PIN attempts.
 *
 * This removes local device state only — the Stellar account and any encrypted
 * cloud backup are untouched. Callers MUST have warned the user beforehand
 * (see shouldWarnAboutWipe) because a user without a cloud backup loses the
 * wallet permanently.
 */
export async function wipeWalletAfterFailedAttempts(): Promise<void> {
  clearSessionPin();
  await clearWallet();
}

// ─── Core wallet API ──────────────────────────────────────────────────────────

export async function getWalletFromSession(): Promise<StellarWallet | null> {
  const wallet = getCachedWallet();
  if (wallet) return wallet;

  const pin = getCachedPin();
  if (!pin) return null;

  const res = await getWallet(pin);
  return res.success ? res.wallet : null;
}

export async function createWallet(pin: string): Promise<string> {
  const keypair = StellarSdk.Keypair.random();
  const publicKey = keypair.publicKey();
  const secret = keypair.secret();

  await Promise.all([storeSecret(secret, pin), storePinVerifier(pin)]);
  cachePinForSession(pin);
  cacheWalletForSession(secret);

  return publicKey;
}

export async function getWallet(pin: string): Promise<GetWalletResult> {
  try {
    const pinResult = await verifyPin(pin);
    if (!pinResult.success) {
      return { success: false, wallet: null, error: pinResult.error, rawError: pinResult.rawError };
    }

    const secret = await readSecret(pin);
    if (!secret) {
      return { success: false, wallet: null, error: 'STORAGE_ERROR' };
    }

    cachePinForSession(pin);
    const wallet = cacheWalletForSession(secret);
    return { success: true, wallet };
  } catch (error) {
    Logger.error('Error getting wallet:', error);
    return { success: false, wallet: null, error: 'STORAGE_ERROR', rawError: error };
  }
}

export async function getWalletFromBiometricBackup(
  authenticationPrompt: string = 'Unlock wallet',
): Promise<StellarWallet | null> {
  const secret = await recoverWalletWithBiometric(authenticationPrompt);
  if (!secret) return null;
  return createWalletObject(secret);
}

export async function hasWallet(): Promise<boolean> {
  try {
    const wallet = await SecureStore.getItemAsync(WALLET_KEY);
    const pin = await SecureStore.getItemAsync(PIN_KEY);
    return !!wallet && !!pin;
  } catch (error) {
    Logger.error('Error checking wallet:', error);
    return false;
  }
}

export async function verifyPin(pin: string, options: VerifyPinOptions = {}): Promise<VerifyPinResult> {
  try {
    const { migrate = true, blockMigration = true } = options;
    const candidates = [
      [PIN_KEY, SALT_KEY],
      [PENDING_PIN_KEY, PENDING_SALT_KEY],
    ] as const;
    let pinHash: string | null = null;
    let verifier: ReturnType<typeof parsePinVerifier> | null = null;
    for (const [pinKey, saltKey] of candidates) {
      const [storedPinVerifier, saltHex] = await Promise.all([
        SecureStore.getItemAsync(pinKey), SecureStore.getItemAsync(saltKey),
      ]);
      if (!storedPinVerifier || !saltHex) continue;
      const parsed = parsePinVerifier(storedPinVerifier);
      const candidateHash = await hashPinWithSalt(pin, saltHex, parsed.kdfIterations);
      if (parsed.hash === candidateHash) {
        pinHash = candidateHash;
        verifier = parsed;
        break;
      }
    }

    const isValid = pinHash !== null;

    if (isValid) {
      cachedPinHash = pinHash!;
      cachePinForSession(pin);

      if (verifier!.needsMigration && migrate) {
        const migration = storePinVerifier(pin);
        if (blockMigration) {
          await migration;
        } else {
          void migration.catch((error) => {
// [SECURITY] Removed sensitive log: console.warn('PIN verifier migration failed:', error);
          });
        }
      }
      return { success: true };
    }

    return { success: false, error: 'INVALID_PIN' };
  } catch (error) {
// [SECURITY] Removed sensitive log: console.error('Error verifying PIN:', error);
    return { success: false, error: 'STORAGE_ERROR', rawError: error };
  }
}

export async function changeWalletPin(oldPin: string, newPin: string): Promise<void> {
  const pinResult = await verifyPin(oldPin, { migrate: false });
  if (!pinResult.success) {
    if (pinResult.error === 'STORAGE_ERROR') {
      throw new Error("Couldn't access secure storage — try again.");
    }
    throw new Error('Invalid current PIN');
  }

  const secret = await readSecret(oldPin);
  if (!secret) throw new Error('Wallet not found');

  // Stage every new value first. The old wallet remains usable until the
  // staged wallet and verifier have both been written and validated.
  const pendingSalt = bytesToHex(await Crypto.getRandomBytesAsync(16));
  const pendingHash = await hashPinWithSalt(newPin, pendingSalt, PIN_KDF_ITERATIONS);
  const pendingVerifier: StoredPinVerifierPayload = {
    version: PIN_VERIFIER_VERSION,
    kdf: 'pbkdf2-sha256',
    kdfIterations: PIN_KDF_ITERATIONS,
    hash: pendingHash,
    updatedAt: new Date().toISOString(),
  };
  await SecureStore.setItemAsync(PENDING_SALT_KEY, pendingSalt);
  await SecureStore.setItemAsync(PENDING_PIN_KEY, JSON.stringify(pendingVerifier));
  await storeSecretWithSalt(secret, newPin, hexToBytes(pendingSalt), PENDING_WALLET_KEY);
  if (!(await readSecretAt(newPin, PENDING_WALLET_KEY))) {
    throw new Error('Unable to validate staged wallet during PIN change');
  }

  // Copying can be interrupted safely: verifyPin/readSecret also inspect the
  // complete pending set, so either old or new credentials remain usable.
  await SecureStore.setItemAsync(WALLET_KEY, (await SecureStore.getItemAsync(PENDING_WALLET_KEY))!);
  await SecureStore.setItemAsync(SALT_KEY, pendingSalt);
  await SecureStore.setItemAsync(PIN_KEY, JSON.stringify(pendingVerifier));
  await Promise.all([
    SecureStore.deleteItemAsync(PENDING_WALLET_KEY),
    SecureStore.deleteItemAsync(PENDING_SALT_KEY),
    SecureStore.deleteItemAsync(PENDING_PIN_KEY),
  ]);
  cachePinForSession(newPin);
  cacheWalletForSession(secret);
}

// ─── PIN verifier helpers ─────────────────────────────────────────────────────

async function storePinVerifier(pin: string): Promise<void> {
  const pinHash = await hashPin(pin);
  const payload: StoredPinVerifierPayload = {
    version: PIN_VERIFIER_VERSION,
    kdf: 'pbkdf2-sha256',
    kdfIterations: PIN_KDF_ITERATIONS,
    hash: pinHash,
    updatedAt: new Date().toISOString(),
  };
  await SecureStore.setItemAsync(PIN_KEY, JSON.stringify(payload));
  cachedPinHash = pinHash;
}

async function hashPin(pin: string): Promise<string> {
  let saltHex = await SecureStore.getItemAsync(SALT_KEY);
  if (!saltHex) {
    saltHex = bytesToHex(await Crypto.getRandomBytesAsync(16));
    await SecureStore.setItemAsync(SALT_KEY, saltHex);
  }
  return hashPinWithSalt(pin, saltHex, PIN_KDF_ITERATIONS);
}

function parsePinVerifier(stored: string): {
  hash: string;
  kdfIterations: number;
  needsMigration: boolean;
} {
  try {
    const payload = JSON.parse(stored) as Partial<StoredPinVerifierPayload>;
    if (
      payload.version === PIN_VERIFIER_VERSION &&
      payload.kdf === 'pbkdf2-sha256' &&
      payload.hash &&
      payload.kdfIterations
    ) {
      return {
        hash: payload.hash,
        kdfIterations: payload.kdfIterations,
        needsMigration: payload.kdfIterations !== PIN_KDF_ITERATIONS,
      };
    }
  } catch {
    // Legacy verifier was stored as a raw hex hash.
  }

  return { hash: stored, kdfIterations: LEGACY_PIN_KDF_ITERATIONS, needsMigration: true };
}

async function hashPinWithSalt(pin: string, saltHex: string, iterations: number): Promise<string> {
  const verifier = await pbkdf2Async(
    sha256,
    utf8ToBytes(`pin-verifier:${pin}`),
    hexToBytes(saltHex),
    { c: iterations, dkLen: 32 },
  );
  return bytesToHex(verifier);
}

async function deriveWalletKey(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  return pbkdf2Async(
    sha256,
    utf8ToBytes(`wallet-secret:${pin}`),
    salt,
    { c: iterations, dkLen: 32 },
  );
}

// ─── Wallet encryption ────────────────────────────────────────────────────────

async function storeSecret(secret: string, pin: string): Promise<void> {
  await storeSecretWithSalt(secret, pin, await Crypto.getRandomBytesAsync(16), WALLET_KEY);
}

async function storeSecretWithSalt(secret: string, pin: string, salt: Uint8Array, keyName: string): Promise<void> {
  const wallet = createWalletObject(secret);
  const nonce = await Crypto.getRandomBytesAsync(24);
  const key = await deriveWalletKey(pin, salt, WALLET_KDF_ITERATIONS);
  const cipher = xchacha20poly1305(key, nonce);
  const ciphertext = cipher.encrypt(utf8ToBytes(secret));

  const payload: StoredWalletPayload = {
    version: WALLET_STORAGE_VERSION,
    publicKey: wallet.publicKey,
    cipher: 'xchacha20-poly1305',
    kdf: 'pbkdf2-sha256',
    kdfIterations: WALLET_KDF_ITERATIONS,
    kdfVersion: WALLET_KDF_VERSION,
    salt: bytesToHex(salt),
    nonce: bytesToHex(nonce),
    ciphertext: bytesToHex(ciphertext),
    updatedAt: new Date().toISOString(),
  };

  await SecureStore.setItemAsync(keyName, JSON.stringify(payload));
}

/**
 * Re-wrap a decrypted wallet at the current KDF cost if it was stored at a
 * weaker one (issue #36).
 *
 * Runs only after a successful unlock, so the user is never asked to re-enter
 * or re-import anything — the migration is invisible. A fresh salt and nonce
 * are generated, so this is a full re-encryption rather than a rewrite of the
 * same ciphertext.
 *
 * Returns true if a re-wrap was performed.
 */
async function maybeRewrapWalletSecret(
  secret: string,
  pin: string,
  payload: Partial<StoredWalletPayload>,
  keyName: string,
): Promise<boolean> {
  const atCurrentCost = payload.kdfIterations === WALLET_KDF_ITERATIONS;
  const atCurrentVersion = (payload.kdfVersion ?? 1) === WALLET_KDF_VERSION;
  if (atCurrentCost && atCurrentVersion) return false;

  await storeSecretWithSalt(secret, pin, await Crypto.getRandomBytesAsync(16), keyName);
  return true;
}

async function readSecret(pin: string): Promise<string | null> {
  return (await readSecretAt(pin, WALLET_KEY)) || (await readSecretAt(pin, PENDING_WALLET_KEY));
}

async function readSecretAt(pin: string, keyName: string): Promise<string | null> {
  const stored = await SecureStore.getItemAsync(keyName);
  if (!stored) return null;

  try {
    const payload = JSON.parse(stored) as Partial<StoredWalletPayload>;
    if (
      payload.version !== WALLET_STORAGE_VERSION ||
      payload.cipher !== 'xchacha20-poly1305' ||
      payload.kdf !== 'pbkdf2-sha256' ||
      !payload.salt ||
      !payload.nonce ||
      !payload.ciphertext ||
      !payload.kdfIterations
    ) {
      return null;
    }

    const key = await deriveWalletKey(pin, hexToBytes(payload.salt), payload.kdfIterations);
    const cipher = xchacha20poly1305(key, hexToBytes(payload.nonce));
    const plaintext = cipher.decrypt(hexToBytes(payload.ciphertext));
    const secret = bytesToUtf8(plaintext);

    if (StellarSdk.StrKey.isValidEd25519SecretSeed(secret)) {
      // Issue #36 migration: a wallet wrapped at an older/weaker KDF cost is
      // re-wrapped at the current one now that we hold the plaintext and a
      // verified PIN. Best-effort and non-blocking — a failure here must never
      // prevent an otherwise valid unlock, since the existing blob still works.
      void maybeRewrapWalletSecret(secret, pin, payload, keyName).catch((error) => {
// [SECURITY] Removed sensitive log: console.warn('Wallet KDF re-wrap failed; keeping existing blob:', error);
      });
      return secret;
    }
  } catch (error) {
    Logger.error('Wallet decrypt failed:', error);
    return null;
  }

  return null;
}

// ─── Biometric backup ─────────────────────────────────────────────────────────

async function storeBiometricBackup(
  secret: string,
  authenticationPrompt: string = 'Secure wallet recovery',
): Promise<boolean> {
  const wallet = createWalletObject(secret);
  const payload: StoredBiometricPayload = {
    version: 1,
    publicKey: wallet.publicKey,
    secret,
    updatedAt: new Date().toISOString(),
  };

  try {
    await SecureStore.setItemAsync(BIOMETRIC_BACKUP_KEY, JSON.stringify(payload), {
      requireAuthentication: true,
      authenticationPrompt,
    });
    await SecureStore.setItemAsync(BIOMETRIC_BACKUP_AVAILABLE_KEY, 'true');
    return true;
  } catch (error) {
    Logger.warn('Biometric backup could not be stored:', error);
    await SecureStore.deleteItemAsync(BIOMETRIC_BACKUP_AVAILABLE_KEY);
    return false;
  }
}

export async function enableWalletBiometricBackup(
  authenticationPrompt: string = 'Enable biometric unlock',
  secretOverride?: string,
): Promise<boolean> {
  const wallet = secretOverride ? null : await getWalletFromSession();
  const secret = secretOverride || wallet?.secret;
  if (!secret) throw new Error('Unlock with PIN before enabling biometric authentication');
  return storeBiometricBackup(secret, authenticationPrompt);
}

export async function clearBiometricBackup(): Promise<void> {
  await SecureStore.deleteItemAsync(BIOMETRIC_BACKUP_KEY);
  await SecureStore.deleteItemAsync(BIOMETRIC_BACKUP_AVAILABLE_KEY);
}

export async function clearWallet(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(WALLET_KEY);
    await SecureStore.deleteItemAsync(PENDING_WALLET_KEY);
    await SecureStore.deleteItemAsync(SALT_KEY);
    await SecureStore.deleteItemAsync(PENDING_SALT_KEY);
    await SecureStore.deleteItemAsync(BIOMETRIC_BACKUP_KEY);
    await SecureStore.deleteItemAsync(BIOMETRIC_BACKUP_AVAILABLE_KEY);
    await SecureStore.deleteItemAsync(PIN_KEY);
    await SecureStore.deleteItemAsync(PENDING_PIN_KEY);
    await SecureStore.deleteItemAsync(PIN_ATTEMPTS_KEY);
    cachedPinHash = null;
    clearSessionPin();
  } catch (error) {
    Logger.error('Error clearing wallet:', error);
  }
}

export async function recoverWalletWithBiometric(
  authenticationPrompt: string = 'Unlock wallet to reset PIN',
): Promise<string | null> {
  try {
    const stored = await SecureStore.getItemAsync(BIOMETRIC_BACKUP_KEY, {
      authenticationPrompt,
      requireAuthentication: true,
    });

    if (!stored) return null;

    const secret = parseBiometricSecret(stored);
    if (!secret) throw new Error('Invalid wallet backup');
    return secret;
  } catch (error: any) {
    if (error.message?.includes('cancel') || error.message?.includes('Authentication canceled')) {
      throw new Error('Authentication cancelled');
    }
    if (error.message?.includes('failed') || error.message?.includes('not recognized')) {
      throw new Error('Biometric authentication failed. Please try again.');
    }
    if (error.message?.includes('not found') || error.message?.includes('no entry')) {
      throw new Error('No biometric backup available. Wallet was created without biometric support.');
    }
    throw new Error('Failed to recover wallet. Please contact support.');
  }
}

function parseBiometricSecret(stored: string): string | null {
  try {
    const payload = JSON.parse(stored) as Partial<StoredBiometricPayload>;
    if (payload.secret && StellarSdk.StrKey.isValidEd25519SecretSeed(payload.secret)) {
      return payload.secret;
    }
  } catch {
    if (StellarSdk.StrKey.isValidEd25519SecretSeed(stored)) return stored;
  }
  return null;
}

export async function hasBiometricBackup(): Promise<boolean> {
  try {
    const backupFlag = await SecureStore.getItemAsync(BIOMETRIC_BACKUP_AVAILABLE_KEY);
    return backupFlag === 'true';
  } catch {
    return false;
  }
}

export async function recreateWalletFromSecret(secret: string, newPin: string): Promise<string> {
  if (!StellarSdk.StrKey.isValidEd25519SecretSeed(secret)) throw new Error('Invalid wallet backup');
  const wallet = createWalletObject(secret);
  await storeSecret(secret, newPin);
  await SecureStore.deleteItemAsync(SALT_KEY);
  await storePinVerifier(newPin);
  cachePinForSession(newPin);
  cacheWalletForSession(secret);
  return wallet.publicKey;
}

// ─── Session wallet cache ─────────────────────────────────────────────────────

function getCachedWallet(): StellarWallet | null {
  if (!cachedWallet) return null;
  if (Date.now() >= cachedWallet.expiresAt) {
    cachedWallet = null;
    return null;
  }
  return cachedWallet.wallet;
}

function cacheWalletForSession(secret: string, ttlMs: number = SESSION_PIN_TTL_MS): StellarWallet {
  const wallet = createWalletObject(secret);
  cachedWallet = { wallet, expiresAt: Date.now() + ttlMs };
  return wallet;
}

// ─── Wallet object factory ────────────────────────────────────────────────────

function createWalletObject(secret: string): StellarWallet {
  const keypair = StellarSdk.Keypair.fromSecret(secret);
  const publicKey = keypair.publicKey();

  return {
    address: publicKey,
    publicKey,
    secret,
    keypair,
    signXdr: (xdr: string, networkPassphrase: string) =>
      signTransactionEnvelopeXdr(xdr, networkPassphrase, keypair),
  };
}

function signTransactionEnvelopeXdr(
  envelopeXdr: string,
  networkPassphrase: string,
  keypair: StellarSdk.Keypair,
): string {
  const envelope = StellarSdk.xdr.TransactionEnvelope.fromXDR(envelopeXdr, 'base64');
  const envelopeType = envelope.switch();

  if (envelopeType === StellarSdk.xdr.EnvelopeType.envelopeTypeTx()) {
    const txEnvelope = envelope.v1();
    const tx = txEnvelope.tx();
    const signatures = txEnvelope.signatures().slice();
    signatures.push(signTransactionPayload(tx, networkPassphrase, keypair));
    return encodeXdrBase64(
      StellarSdk.xdr.TransactionEnvelope.envelopeTypeTx(
        new StellarSdk.xdr.TransactionV1Envelope({ tx, signatures }),
      ),
    );
  }

  if (envelopeType === StellarSdk.xdr.EnvelopeType.envelopeTypeTxV0()) {
    const txEnvelope = envelope.v0();
    const txV0 = txEnvelope.tx();
    const signatures = txEnvelope.signatures().slice();
    const tx = StellarSdk.xdr.Transaction.fromXDR(
      Buffer.concat([
        (StellarSdk.xdr.PublicKeyType.publicKeyTypeEd25519() as any).toXDR(),
        txV0.toXDR(),
      ]),
    );
    signatures.push(signTransactionPayload(tx, networkPassphrase, keypair));
    return encodeXdrBase64(
      StellarSdk.xdr.TransactionEnvelope.envelopeTypeTxV0(
        new StellarSdk.xdr.TransactionV0Envelope({ tx: txV0, signatures }),
      ),
    );
  }

  throw new Error(`Unsupported transaction envelope type: ${envelopeType.name}`);
}

function signTransactionPayload(
  tx: StellarSdk.xdr.Transaction,
  networkPassphrase: string,
  keypair: StellarSdk.Keypair,
): StellarSdk.xdr.DecoratedSignature {
  const taggedTransaction =
    StellarSdk.xdr.TransactionSignaturePayloadTaggedTransaction.envelopeTypeTx(tx);
  const signaturePayload = new StellarSdk.xdr.TransactionSignaturePayload({
    networkId: StellarSdk.xdr.Hash.fromXDR(StellarSdk.hash(Buffer.from(networkPassphrase, 'utf8'))),
    taggedTransaction,
  });
  const txHash = StellarSdk.hash(signaturePayload.toXDR());
  return keypair.signDecorated(txHash);
}

function encodeXdrBase64(value: { toXDR: () => Buffer | Uint8Array }): string {
  return Buffer.from(value.toXDR()).toString('base64');
}
