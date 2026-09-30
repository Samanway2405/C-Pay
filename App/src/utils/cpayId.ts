import { Logger } from './logger';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../services/supabase';

/**
 * C-Pay ID System - User-friendly identifier instead of wallet addresses
 * Format: email-handle-or-phone@cpay+walletHash
 * Example: soumen0818@cpayk8f3qz
 *
 * This is ONLY for UI display. Payment operations still use actual Stellar accounts.
 */

const CPAY_SUFFIX_LENGTH = 6;

/**
 * Create a short deterministic wallet fingerprint for display IDs.
 * This is a UI identifier, not a security primitive.
 */
export function getWalletFingerprint(walletAddress: string, length: number = CPAY_SUFFIX_LENGTH): string {
  const normalized = walletAddress.trim().toLowerCase();
  let hash = 0x811c9dc5;

  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(36).padStart(length, '0').slice(-length);
}

export function formatWalletFingerprint(walletAddress: string): string {
  return `C-Pay wallet #${getWalletFingerprint(walletAddress).toUpperCase()}`;
}

function isLegacyAddressSuffixId(cpayId: string | null | undefined, walletAddress: string): boolean {
  if (!cpayId) {
    return false;
  }

  const suffix = cpayId.split('@cpay')[1]?.toLowerCase();
  return suffix === walletAddress.trim().toLowerCase().slice(-4);
}

function isGeneratedCPayIdOutdated(
  cpayId: string | null | undefined,
  preferredIdentifier: string,
  walletAddress: string
): boolean {
  if (!cpayId || isLegacyAddressSuffixId(cpayId, walletAddress)) {
    return true;
  }

  return Boolean(preferredIdentifier) && cpayId.toLowerCase() !== generateCPayId(preferredIdentifier, walletAddress);
}

async function getStoredPhoneNumber(): Promise<string | null> {
  return (
    await AsyncStorage.getItem('phone_number') ||
    await AsyncStorage.getItem('user_phone')
  );
}

async function getStoredEmail(): Promise<string | null> {
  return AsyncStorage.getItem('user_email');
}

function normalizeCPayHandle(identifier: string): string {
  const trimmed = identifier.trim().toLowerCase();
  const emailLocalPart = trimmed.includes('@') ? trimmed.split('@')[0] : '';

  if (emailLocalPart) {
    const withoutPlusTag = emailLocalPart.split('+')[0];
    const emailHandle = withoutPlusTag
      .replace(/[^a-z0-9._-]/g, '')
      .replace(/^[._-]+|[._-]+$/g, '')
      .slice(0, 20);

    return emailHandle.length >= 3 ? emailHandle : 'user';
  }

  const phone10Digit = trimmed.replace(/\D/g, '').slice(-10);
  return phone10Digit || 'user';
}

/**
 * Generate C-Pay ID from email/phone and wallet address.
 * @param identifier - User email or phone number.
 * @param walletAddress - Stellar account address
 * @returns C-Pay ID (e.g., "soumen0818@cpayk8f3qz")
 */
export function generateCPayId(identifier: string, walletAddress: string): string {
  const handle = normalizeCPayHandle(identifier);
  const suffix = getWalletFingerprint(walletAddress);

  return `${handle}@cpay${suffix}`;
}

/**
 * Get C-Pay ID for current user from database or generate a local fallback.
 * Missing or legacy address-suffix IDs are repaired in Supabase when possible.
 */
export async function getCurrentUserCPayId(): Promise<string | null> {
  try {
    const walletAddress = await AsyncStorage.getItem('wallet_address');

    if (!walletAddress) {
      return null;
    }

    const [localEmail, localPhone] = await Promise.all([
      getStoredEmail(),
      getStoredPhoneNumber(),
    ]);
    const localIdentifier = localEmail || localPhone || '';
    const localId = generateCPayId(localIdentifier, walletAddress);

    // Fetch from database first, then self-heal missing/legacy IDs.
    const { data, error } = await supabase
      .from('users')
      .select('cpay_id, email, phone_number')
      .eq('wallet_address', walletAddress)
      .single();

    const preferredIdentifier = data?.email || localEmail || data?.phone_number || localPhone || '';
    if (!error && data?.cpay_id && !isGeneratedCPayIdOutdated(data.cpay_id, preferredIdentifier, walletAddress)) {
      await AsyncStorage.setItem('cpay_id', data.cpay_id);
      return data.cpay_id;
    }

    const generatedId = generateCPayId(preferredIdentifier, walletAddress);

    await AsyncStorage.setItem('cpay_id', generatedId);

    if (!error && data) {
      await supabase
        .from('users')
        .update({ cpay_id: generatedId })
        .eq('wallet_address', walletAddress);
    }

    return generatedId || localId;
  } catch (error) {
    Logger.error('Error getting current user C-Pay ID:', error);
    const walletAddress = await AsyncStorage.getItem('wallet_address');
    if (!walletAddress) {
      return null;
    }
    const email = await getStoredEmail();
    const phone = await getStoredPhoneNumber();
    return generateCPayId(email || phone || '', walletAddress);
  }
}

/**
 * Get C-Pay ID for any wallet address by fetching from database.
 * @param walletAddress - Wallet address to look up
 * @returns C-Pay ID or null if not found in database
 */
export async function getCPayIdByWallet(walletAddress: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('get_public_wallet_profile', {
      p_wallet_address: walletAddress,
    });

    if (!error && Array.isArray(data) && data[0]?.cpay_id && !isLegacyAddressSuffixId(data[0].cpay_id, walletAddress)) {
      return data[0].cpay_id;
    }

    const currentWallet = await AsyncStorage.getItem('wallet_address');
    if (currentWallet?.toLowerCase() === walletAddress.toLowerCase()) {
      return getCurrentUserCPayId();
    }

    return null;
  } catch (error) {
    Logger.error('Error fetching C-Pay ID:', error);
    return null;
  }
}

/**
 * Get display identifier for wallet address
 * Priority: C-Pay ID > Display Name > Wallet fingerprint
 * @param walletAddress - Wallet address
 * @param displayName - Optional display name
 * @returns User-friendly identifier
 */
export async function getDisplayIdentifier(
  walletAddress: string,
  displayName?: string | null
): Promise<string> {
  // Try to get C-Pay ID first
  const cpayId = await getCPayIdByWallet(walletAddress);
  if (cpayId) {
    return cpayId;
  }
  
  // Fallback to display name if available
  if (displayName) {
    return displayName;
  }
  
  // Final fallback: hashed wallet fingerprint
  return formatWalletFingerprint(walletAddress);
}

/**
 * Format C-Pay ID for display (optional - adds styling/formatting)
 * @param cpayId - C-Pay ID to format
 * @returns Formatted string
 */
export function formatCPayIdForDisplay(cpayId: string): string {
  return cpayId; // Currently returns as-is, but can be enhanced with formatting
}

/**
 * Validate if a string is a valid C-Pay ID format
 * @param id - String to validate
 * @returns true if valid C-Pay ID format
 */
export function isValidCPayId(id: string): boolean {
  const pattern = /^[a-z0-9._-]{3,20}@cpay[a-z0-9]{4,8}$/i;
  return pattern.test(id);
}

/**
 * Extract wallet hash suffix from C-Pay ID
 * @param cpayId - C-Pay ID
 * @returns Wallet hash suffix or null
 */
export function extractLast4FromCPayId(cpayId: string): string | null {
  const match = cpayId.match(/@cpay([a-z0-9]{4,8})$/i);
  return match ? match[1] : null;
}

/**
 * Extract phone number from C-Pay ID
 * @param cpayId - C-Pay ID
 * @returns Phone number (10 digits) or null
 */
export function extractPhoneFromCPayId(cpayId: string): string | null {
  const match = cpayId.match(/^(\d{10})@cpay/);
  return match ? match[1] : null;
}

/**
 * Get wallet address from C-Pay ID using the public user profile lookup.
 * @param cpayId - C-Pay ID to look up
 * @returns Wallet address or null if not found
 */
export async function getWalletAddressFromCPayId(cpayId: string): Promise<string | null> {
  try {
    const normalizedId = cpayId.trim().toLowerCase();

    const { data, error } = await supabase.rpc('resolve_cpay_id', {
      p_cpay_id: normalizedId,
    });

    if (!error && Array.isArray(data) && data[0]?.wallet_address) {
      return data[0].wallet_address;
    }

    return null;
  } catch (error) {
    Logger.error('Error getting wallet address from C-Pay ID:', error);
    return null;
  }
}
