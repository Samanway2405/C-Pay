import { Logger } from '../utils/logger';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import EventEmitter from 'eventemitter3';
import { generateCPayId } from '../utils/cpayId';
import { getNetworkConfig, isValidTransactionHash, isValidAccountId } from './blockchain';

// Event emitter for real-time updates
export const storageEvents = new EventEmitter();

export interface Transaction {
  id?: string;
  transaction_id?: string; // Legacy readable ID; new receipts use tx_hash.
  user_id?: string;
  tx_hash: string;
  to_address: string;
  from_address?: string;
  amount: string;
  stellar_network?: string;
  asset_code?: string;
  asset_issuer?: string;
  status: 'pending' | 'success' | 'failed';
  // Phase 2: Invisible Rail - Two-tier status system
  internal_status?: 'processing' | 'submitted' | 'confirmed' | 'failed';
  user_visible_status?: 'success' | 'failed';
  // Transaction type: personal (P2P) or merchant (business payment)
  transaction_type?: 'personal' | 'merchant';
  merchant_id?: string; // Reference to merchant if transaction_type is 'merchant'
  merchant_name?: string; // Business name (for backward compatibility)
  note?: string; // Optional payment note
  sender_name?: string; // Name of the person who sent the payment
  recipient_name?: string; // Name of recipient (person or business)
  created_at?: string;
  submitted_at?: string; // When user clicked "Pay"
  confirmed_at?: string; // When blockchain confirmed
  failure_reason?: string; // User-friendly error message
}

// Hybrid storage: Local (AsyncStorage) + Cloud (Supabase)
// Works offline, syncs when online

async function getCurrentAuthUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id || null;
}

// Helper function to get user's display name from Supabase by wallet address
export async function getUserDisplayName(walletAddress: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('get_public_wallet_profile', {
      p_wallet_address: walletAddress,
    });

    if (!error && Array.isArray(data) && data[0]?.display_name) {
      return data[0].display_name;
    }
    return null;
  } catch (error) {
    Logger.info('Error fetching user display name:', error);
    return null;
  }
}

// Helper function to get or create user in Supabase
async function getOrCreateUser(walletAddress: string, phoneNumber?: string, displayName?: string): Promise<string | null> {
  try {
    const authUserId = await getCurrentAuthUserId();

    // Check if user exists
    const { data: existingUser, error: fetchError } = await supabase
      .from('users')
      .select('id')
      .eq('wallet_address', walletAddress)
      .maybeSingle();

    if (existingUser && !fetchError) {
      return existingUser.id;
    }

    // Create new user
    const verifiedEmail = await AsyncStorage.getItem('user_email');
    const cpayId = walletAddress ? generateCPayId(verifiedEmail || phoneNumber || '', walletAddress) : null;

    const { data: newUser, error: insertError } = await supabase
      .from('users')
      .insert({
        auth_user_id: authUserId,
        wallet_address: walletAddress,
        email: verifiedEmail || null,
        phone_number: phoneNumber || null,
        display_name: displayName || null,
        cpay_id: cpayId, // Save C-Pay ID to database
      })
      .select('id')
      .single();

    if (newUser && !insertError) {
      Logger.info('✅ User created in Supabase:', newUser.id);
      return newUser.id;
    }

    Logger.info('Error creating user:', insertError?.message);
    return null;
  } catch (error) {
    Logger.info('Error in getOrCreateUser:', error);
    return null;
  }
}

export async function saveTransaction(tx: Transaction): Promise<void> {
  try {
    const networkConfig = getNetworkConfig();

    const hasBlockchainHash = isValidTransactionHash(tx.tx_hash);

    // Save locally first (offline-first approach)
    const existing = await AsyncStorage.getItem('transactions');
    const txs = existing ? JSON.parse(existing) : [];

    // Add timestamp and network metadata. transaction_id is legacy and stays nullable;
    // the Stellar transaction hash is the receipt identifier.
    const txWithTime = {
      ...tx,
      created_at: tx.created_at || new Date().toISOString(),
      id: tx.id || tx.tx_hash,
      transaction_id: tx.transaction_id,
      transaction_type: tx.transaction_type || 'personal',
      stellar_network: tx.stellar_network || networkConfig.network,
      asset_code: tx.asset_code || networkConfig.assetCode,
      asset_issuer: tx.asset_issuer || networkConfig.assetIssuer,
    };

    const existingIndex = txs.findIndex((item: Transaction) => item.tx_hash === txWithTime.tx_hash);
    const nextTxs = existingIndex >= 0
      ? txs.map((item: Transaction, index: number) =>
          index === existingIndex ? { ...item, ...txWithTime } : item
        )
      : [txWithTime, ...txs];

    await AsyncStorage.setItem('transactions', JSON.stringify(nextTxs));

// [SECURITY] Removed sensitive log: console.log('✅ Transaction saved locally:', txWithTime.tx_hash);

    // Emit event for real-time UI updates
    storageEvents.emit('transactionSaved', txWithTime);
// [SECURITY] Removed sensitive log: console.log('📡 Emitted transactionSaved event');
  } catch (error) {
// [SECURITY] Removed sensitive log: console.error('Error saving transaction:', error);
    throw error;
  }
}

export async function getTransactions(): Promise<Transaction[]> {
  try {
    // Get from local storage first (always available)
    const local = await AsyncStorage.getItem('transactions');
    const rawLocalTxs = local ? JSON.parse(local) : [];
    const localTxs = rawLocalTxs.filter((tx: Transaction) => isValidTransactionHash(tx.tx_hash));
    
// [SECURITY] Removed sensitive log: console.log(`📦 Loaded ${localTxs.length} transactions from local storage`);

    // Sync with Supabase in background (read-only trusted receipts)
    try {
      const walletAddress = await AsyncStorage.getItem('wallet_address');
      
      if (!walletAddress) {
        Logger.info('No wallet address found, using local data only');
        return localTxs;
      }

      // Guard against filter-injection: validate the wallet address before
      // interpolating it into the PostgREST .or() string.  supabase-js v2 only
      // accepts .or() as a raw string (no parameter-object API), so strict
      // call-boundary validation is the correct mitigation here.
      // isValidAccountId uses the Stellar SDK's Ed25519 public-key checker,
      // which rejects anything that isn't a well-formed G-account address.
      if (!isValidAccountId(walletAddress)) {
// [SECURITY] Removed sensitive log: console.warn('Skipping Supabase fetch: wallet address failed validation', walletAddress);
        return localTxs;
      }

      // Fetch transactions from Supabase (both sent and received).
      // walletAddress is a validated Stellar Ed25519 public key (56-char base32
      // starting with "G"), so interpolation here cannot carry filter syntax.
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .or(`from_address.eq.${walletAddress},to_address.eq.${walletAddress}`)
        .order('created_at', { ascending: false })
        .limit(100);

      if (data && !error && data.length > 0) {
        const chainTxs = data.filter((tx: Transaction) => isValidTransactionHash(tx.tx_hash));
// [SECURITY] Removed sensitive log: console.log(`☁️ Loaded ${chainTxs.length} transactions from Supabase`);

        // Merge local and cloud data (remove duplicates by tx_hash)
        const mergedTxs = [...chainTxs];
        const txHashes = new Set(chainTxs.map(tx => tx.tx_hash));
        
        localTxs.forEach((localTx: Transaction) => {
          if (!txHashes.has(localTx.tx_hash)) {
            mergedTxs.push(localTx);
          }
        });
        
        // Sort by created_at
        mergedTxs.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
        
        // Update local cache with merged data
        await AsyncStorage.setItem('transactions', JSON.stringify(mergedTxs));
        return mergedTxs;
      }
    } catch (supabaseError) {
      Logger.info('Supabase fetch skipped (using local data):', supabaseError);
    }

    // Return local data
    return localTxs;
  } catch (error) {
// [SECURITY] Removed sensitive log: console.error('Error getting transactions:', error);
    return [];
  }
}

export async function updateTransactionStatus(
  txHash: string,
  status: 'pending' | 'success' | 'failed',
  internalStatus?: 'processing' | 'submitted' | 'confirmed' | 'failed',
  confirmedAt?: string,
  failureReason?: string
): Promise<void> {
  try {
    if (!isValidTransactionHash(txHash)) {
      return;
    }

    // Update locally for responsive UI
    const existing = await AsyncStorage.getItem('transactions');
    if (existing) {
      const txs = JSON.parse(existing);
      const updated = txs.map((tx: Transaction) =>
        tx.tx_hash === txHash
          ? {
              ...tx,
              status,
              internal_status: internalStatus || status,
              user_visible_status: status,
              confirmed_at: confirmedAt || (status === 'success' ? new Date().toISOString() : tx.confirmed_at),
              failure_reason: failureReason,
            }
          : tx
      );
      await AsyncStorage.setItem('transactions', JSON.stringify(updated));
    }
  } catch (error) {
// [SECURITY] Removed sensitive log: console.error('Error updating transaction status:', error);
  }
}
