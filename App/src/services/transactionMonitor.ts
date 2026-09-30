import { Logger } from '../utils/logger';
import { getTransactionStatus, isValidTransactionHash, waitForTransaction } from './blockchain';
import { updateTransactionStatus, getTransactions } from './storage';

/**
 * Background service to poll pending transactions and update their status
 * This runs independently and updates Supabase, which triggers real-time updates
 */

let isPolling = false;
let pollingInterval: NodeJS.Timeout | null = null;

/**
 * Check status of a single transaction and update if confirmed
 * Phase 2: Updated to handle internal_status and user_visible_status
 */
export async function checkTransactionStatus(txHash: string): Promise<void> {
  try {
// [SECURITY] Removed sensitive log: console.log(`🔍 Checking status for tx: ${txHash.slice(0, 10)}...`);
    if (!isValidTransactionHash(txHash)) {
// [SECURITY] Removed sensitive log: console.log('Skipping status check for non-Stellar transaction hash');
      return;
    }

    const status = await getTransactionStatus(txHash);
    
    if (status === 'success') {
// [SECURITY] Removed sensitive log: console.log(`✅ Transaction ${txHash.slice(0, 10)}... confirmed`);
      await updateTransactionStatus(
        txHash,
        'success',
        'confirmed',
        new Date().toISOString()
      );
    } else if (status === 'failed') {
// [SECURITY] Removed sensitive log: console.log(`❌ Transaction ${txHash.slice(0, 10)}... failed`);
      await updateTransactionStatus(
        txHash,
        'failed',
        'failed',
        undefined,
        'Transaction failed on blockchain'
      );
    } else if (status === 'pending') {
// [SECURITY] Removed sensitive log: console.log(`⏳ Transaction ${txHash.slice(0, 10)}... still pending`);
    }
  } catch (error) {
// [SECURITY] Removed sensitive log: console.error('Error checking transaction status:', error);
  }
}

/**
 * Poll all pending transactions and update their status
 */
export async function pollPendingTransactions(): Promise<void> {
  try {
    const transactions = await getTransactions();
    const pendingTxs = transactions.filter(tx =>
      tx.status === 'pending' && isValidTransactionHash(tx.tx_hash)
    );
    
    if (pendingTxs.length === 0) {
// [SECURITY] Removed sensitive log: console.log('✨ No pending transactions to poll');
      return;
    }
    
// [SECURITY] Removed sensitive log: console.log(`🔄 Polling ${pendingTxs.length} pending transaction(s)...`);
    
    // Check each pending transaction
    for (const tx of pendingTxs) {
      await checkTransactionStatus(tx.tx_hash);
    }
  } catch (error) {
// [SECURITY] Removed sensitive log: console.error('Error polling pending transactions:', error);
  }
}

/**
 * Start automatic polling of pending transactions
 * Polls every 10 seconds by default
 */
export function startTransactionPolling(intervalMs: number = 10000): void {
  if (isPolling) {
// [SECURITY] Removed sensitive log: console.log('⚠️ Transaction polling already running');
    return;
  }
  
// [SECURITY] Removed sensitive log: console.log(`🚀 Starting transaction polling (every ${intervalMs / 1000}s)...`);
  isPolling = true;
  
  // Poll immediately
  pollPendingTransactions();
  
  // Then poll at intervals
  pollingInterval = setInterval(() => {
    pollPendingTransactions();
  }, intervalMs);
}

/**
 * Stop automatic polling
 */
export function stopTransactionPolling(): void {
  if (!isPolling) {
    return;
  }
  
// [SECURITY] Removed sensitive log: console.log('🛑 Stopping transaction polling...');
  isPolling = false;
  
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

/**
 * Wait for a specific transaction to be confirmed
 * Returns the final status
 * Phase 2: Updated to handle new status fields
 */
export async function waitForTransactionConfirmation(
  txHash: string,
  maxAttempts: number = 60,
  intervalMs: number = 5000
): Promise<'success' | 'failed' | 'timeout'> {
// [SECURITY] Removed sensitive log: console.log(`⏰ Waiting for transaction ${txHash.slice(0, 10)}... to confirm`);
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const status = await getTransactionStatus(txHash);
    
    if (status === 'success') {
// [SECURITY] Removed sensitive log: console.log(`✅ Transaction confirmed after ${attempt} attempt(s)`);
      await updateTransactionStatus(
        txHash,
        'success',
        'confirmed',
        new Date().toISOString()
      );
      return 'success';
    } else if (status === 'failed') {
// [SECURITY] Removed sensitive log: console.log(`❌ Transaction failed after ${attempt} attempt(s)`);
      await updateTransactionStatus(
        txHash,
        'failed',
        'failed',
        undefined,
        'Transaction failed on blockchain'
      );
      return 'failed';
    }
    
    // Wait before next attempt
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  
  // Timeout
// [SECURITY] Removed sensitive log: console.log(`⏰ Transaction ${txHash.slice(0, 10)}... timed out`);
  return 'timeout';
}

/**
 * Smart transaction monitoring
 * Tries waitForTransaction first (fast), then falls back to polling
 * Phase 2: Updated to handle new status fields
 */
export async function monitorTransaction(txHash: string): Promise<void> {
  try {
// [SECURITY] Removed sensitive log: console.log(`🎯 Monitoring transaction: ${txHash.slice(0, 10)}...`);
    
    // Try to wait for transaction (1 confirmation)
    const receipt = await waitForTransaction(txHash, 1);
    
    if (receipt) {
      const status = receipt.status === 1 ? 'success' : 'failed';
      const confirmedAt = new Date().toISOString();
      
// [SECURITY] Removed sensitive log: console.log(`✅ Transaction confirmed via waitForTransaction: ${status}`);
      await updateTransactionStatus(
        txHash,
        status,
        status === 'success' ? 'confirmed' : 'failed',
        status === 'success' ? confirmedAt : undefined,
        status === 'failed' ? 'Transaction failed on blockchain' : undefined
      );
    } else {
      // Fallback to polling if waitForTransaction fails
// [SECURITY] Removed sensitive log: console.log('⚠️ waitForTransaction failed, falling back to polling...');
      await waitForTransactionConfirmation(txHash, 12, 5000); // Poll for 60s
    }
  } catch (error) {
// [SECURITY] Removed sensitive log: console.error('Error monitoring transaction:', error);
    // Fallback to polling
    await waitForTransactionConfirmation(txHash, 12, 5000);
  }
}
