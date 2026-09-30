import { Logger } from '../utils/logger';
import * as Crypto from 'expo-crypto';
import * as StellarSdk from '@stellar/stellar-base';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { bytesToHex, hexToBytes, utf8ToBytes, bytesToUtf8 } from '@noble/ciphers/utils';
import { pbkdf2Async } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import { supabase } from './supabase';
import { StellarWallet } from './wallet';

const CLOUD_BACKUP_VERSION = 1;
const CLOUD_BACKUP_KDF_ITERATIONS = 60000;
const CLOUD_BACKUP_PASSWORD_MIN_LENGTH = 12;

export type CloudWalletBackupRow = {
  id?: string;
  auth_user_id: string;
  wallet_address: string;
  backup_version: number;
  cipher: 'xchacha20-poly1305';
  kdf: 'pbkdf2-sha256';
  kdf_iterations: number;
  salt: string;
  nonce: string;
  ciphertext: string;
  created_at?: string;
  updated_at?: string;
};

export type RestoredCloudWalletBackup = {
  secret: string;
  walletAddress: string;
};

export type RecoveryPasswordRule = {
  id: 'length' | 'uppercase' | 'number' | 'special';
  label: string;
  passed: boolean;
};

export function getRecoveryPasswordRules(password: string): RecoveryPasswordRule[] {
  return [
    {
      id: 'length',
      label: `At least ${CLOUD_BACKUP_PASSWORD_MIN_LENGTH} characters`,
      passed: password.length >= CLOUD_BACKUP_PASSWORD_MIN_LENGTH,
    },
    {
      id: 'uppercase',
      label: 'At least 1 uppercase letter',
      passed: /[A-Z]/.test(password),
    },
    {
      id: 'number',
      label: 'At least 1 number',
      passed: /\d/.test(password),
    },
    {
      id: 'special',
      label: 'At least 1 special character',
      passed: /[^A-Za-z0-9\s]/.test(password),
    },
  ];
}

export function validateRecoveryPassword(password: string): string | null {
  const failedRule = getRecoveryPasswordRules(password).find((rule) => !rule.passed);
  if (failedRule) {
    return `Recovery password must include: ${failedRule.label.toLowerCase()}.`;
  }

  return null;
}

async function getAuthenticatedUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new Error('Email session expired. Verify your email again before using cloud backup.');
  }

  return data.user.id;
}

async function deriveCloudBackupKey(
  recoveryPassword: string,
  salt: Uint8Array,
  iterations: number
): Promise<Uint8Array> {
  return pbkdf2Async(
    sha256,
    utf8ToBytes(`cpay-cloud-wallet:${recoveryPassword}`),
    salt,
    { c: iterations, dkLen: 32 }
  );
}

function getSecretPublicKey(secret: string): string {
  return StellarSdk.Keypair.fromSecret(secret).publicKey();
}

function assertSupportedBackup(row: CloudWalletBackupRow): void {
  if (
    row.backup_version !== CLOUD_BACKUP_VERSION ||
    row.cipher !== 'xchacha20-poly1305' ||
    row.kdf !== 'pbkdf2-sha256' ||
    !row.kdf_iterations ||
    !row.salt ||
    !row.nonce ||
    !row.ciphertext
  ) {
    throw new Error('This cloud backup format is not supported by this app version.');
  }
}

export async function createCloudWalletBackup(
  wallet: StellarWallet,
  recoveryPassword: string
): Promise<void> {
  const validationError = validateRecoveryPassword(recoveryPassword);
  if (validationError) {
    throw new Error(validationError);
  }

  const authUserId = await getAuthenticatedUserId();
  const walletAddress = getSecretPublicKey(wallet.secret);
  if (walletAddress !== wallet.publicKey) {
    throw new Error('Wallet key does not match the active wallet address.');
  }

  const salt = await Crypto.getRandomBytesAsync(16);
  const nonce = await Crypto.getRandomBytesAsync(24);
  const key = await deriveCloudBackupKey(recoveryPassword, salt, CLOUD_BACKUP_KDF_ITERATIONS);
  const cipher = xchacha20poly1305(key, nonce);
  const ciphertext = cipher.encrypt(utf8ToBytes(wallet.secret));

  const row: CloudWalletBackupRow = {
    auth_user_id: authUserId,
    wallet_address: wallet.publicKey,
    backup_version: CLOUD_BACKUP_VERSION,
    cipher: 'xchacha20-poly1305',
    kdf: 'pbkdf2-sha256',
    kdf_iterations: CLOUD_BACKUP_KDF_ITERATIONS,
    salt: bytesToHex(salt),
    nonce: bytesToHex(nonce),
    ciphertext: bytesToHex(ciphertext),
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('wallet_backups')
    .upsert(row, { onConflict: 'auth_user_id' });

  if (error) {
    Logger.error('Cloud wallet backup save error:', error);
    throw new Error('Cloud backup could not be saved. Make sure the wallet_backups SQL has been run in Supabase.');
  }
}

export async function getCloudWalletBackup(): Promise<CloudWalletBackupRow | null> {
  await getAuthenticatedUserId();

  const { data, error } = await supabase
    .from('wallet_backups')
    .select('*')
    .maybeSingle();

  if (error) {
    Logger.error('Cloud wallet backup fetch error:', error);
    throw new Error('Cloud backup could not be loaded.');
  }

  return (data as CloudWalletBackupRow | null) || null;
}

export async function hasCloudWalletBackup(): Promise<boolean> {
  try {
    const backup = await getCloudWalletBackup();
    return !!backup;
  } catch {
    return false;
  }
}

export async function restoreCloudWalletBackup(
  recoveryPassword: string,
  backupOverride?: CloudWalletBackupRow
): Promise<RestoredCloudWalletBackup> {
  const backup = backupOverride || (await getCloudWalletBackup());
  if (!backup) {
    throw new Error('No encrypted wallet backup was found for this email.');
  }

  assertSupportedBackup(backup);

  try {
    const key = await deriveCloudBackupKey(
      recoveryPassword,
      hexToBytes(backup.salt),
      backup.kdf_iterations
    );
    const cipher = xchacha20poly1305(key, hexToBytes(backup.nonce));
    const secret = bytesToUtf8(cipher.decrypt(hexToBytes(backup.ciphertext)));

    if (!StellarSdk.StrKey.isValidEd25519SecretSeed(secret)) {
      throw new Error('Invalid decrypted wallet secret.');
    }

    const restoredWalletAddress = getSecretPublicKey(secret);
    if (restoredWalletAddress !== backup.wallet_address) {
      throw new Error('Cloud backup does not match the stored wallet address.');
    }

    return {
      secret,
      walletAddress: restoredWalletAddress,
    };
  } catch (error) {
    Logger.error('Cloud wallet backup decrypt error:', error);
    throw new Error('Recovery password is incorrect or this cloud backup is damaged.');
  }
}
