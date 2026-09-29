import { Logger } from '../utils/logger';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { formatMoneyAmount } from '../utils/currency';
import { relayerRequest } from './blockchain';

// Client-side limits helper
// Authoritative limit values and aggregations are strictly enforced by the relayer service.
// The client fetches limits from the authenticated server endpoint for instant UX feedback only.

const RATE_LIMIT_KEY = 'rate_limits';

export interface TransactionLimitsStatus {
  maxAmountPerTransaction: number;
  maxDailyAmount: number;
  maxTransactionsPerDay: number;
  maxDailyCount: number;
  maxRequestsPerMinute: number;
  amountToday: number;
  transactionsToday: number;
  remaining: {
    transactions: number;
    amount: number;
  };
}

interface RateLimit {
  action: string;
  timestamps: number[];
}

/**
 * Fetch current transaction limits and usage status from the relayer.
 * Fails closed by throwing if the endpoint or network is unreachable.
 */
export async function getTransactionLimitsStatus(): Promise<TransactionLimitsStatus> {
  try {
    return await relayerRequest<TransactionLimitsStatus>('/payments/limits');
  } catch (error) {
    Logger.error('Failed to get transaction limits status from relayer:', error);
    throw error;
  }
}

/**
 * Check if the user has exceeded limits for instant UX feedback.
 * Note: Relayer enforces all limits authoritatively server-side on submission.
 * Fails closed: an error during the check returns allowed: false.
 */
export async function checkTransactionLimit(amount: string): Promise<{
  allowed: boolean;
  reason?: string;
}> {
  try {
    const amountNum = parseFloat(amount);
    if (!amount || isNaN(amountNum) || amountNum <= 0) {
      return {
        allowed: false,
        reason: 'Please enter a valid amount',
      };
    }

    const limits = await getTransactionLimitsStatus();

    // Check single transaction amount limit
    if (amountNum > limits.maxAmountPerTransaction) {
      return {
        allowed: false,
        reason: `Maximum amount per transaction is ${formatMoneyAmount(limits.maxAmountPerTransaction)}`,
      };
    }

    // Check daily transaction count limit
    if (limits.remaining.transactions <= 0) {
      return {
        allowed: false,
        reason: `Daily transaction limit reached (${limits.maxTransactionsPerDay} transactions per day)`,
      };
    }

    // Check daily amount limit
    if (amountNum > limits.remaining.amount) {
      return {
        allowed: false,
        reason: `Daily amount limit exceeded. ${formatMoneyAmount(limits.remaining.amount)} remaining of ${formatMoneyAmount(limits.maxDailyAmount)} per day`,
      };
    }

    return { allowed: true };
  } catch (error: any) {
    // Fail closed: a limit-check failure rejects rather than allows
    Logger.error('Error checking transaction limit (failing closed):', error);
    return {
      allowed: false,
      reason: error?.message || 'Transaction limits service is temporarily unavailable. Please try again.',
    };
  }
}

/**
 * Record a transaction for limit tracking.
 * Kept for interface compatibility; actual limits tracking is handled
 * server-authoritatively by the relayer service upon payment submission.
 */
export async function recordTransaction(_amount: string): Promise<void> {
  // No-op: Server records payments in the payment_records table upon submission
}

/**
 * Check rate limit for a client-side action.
 * Fails closed: errors return allowed: false.
 */
export async function checkRateLimit(action: string, maxRequestsPerMinute: number = 10): Promise<{
  allowed: boolean;
  reason?: string;
  retryAfter?: number;
}> {
  try {
    const key = `${RATE_LIMIT_KEY}_${action}`;
    const stored = await AsyncStorage.getItem(key);

    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    let rateLimit: RateLimit = stored
      ? JSON.parse(stored)
      : { action, timestamps: [] };

    // Filter out timestamps older than 1 minute
    rateLimit.timestamps = rateLimit.timestamps.filter(ts => ts > oneMinuteAgo);

    // Check if limit exceeded
    if (rateLimit.timestamps.length >= maxRequestsPerMinute) {
      const oldestTimestamp = Math.min(...rateLimit.timestamps);
      const retryAfter = Math.ceil((oldestTimestamp + 60000 - now) / 1000);

      return {
        allowed: false,
        reason: `Too many requests. Please wait ${retryAfter} seconds.`,
        retryAfter,
      };
    }

    return { allowed: true };
  } catch (error) {
    Logger.error('Error checking rate limit (failing closed):', error);
    return {
      allowed: false,
      reason: 'Rate limit verification failed. Please try again.',
    };
  }
}

/**
 * Record action for client-side rate limiting
 */
export async function recordAction(action: string): Promise<void> {
  try {
    const key = `${RATE_LIMIT_KEY}_${action}`;
    const stored = await AsyncStorage.getItem(key);

    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    let rateLimit: RateLimit = stored
      ? JSON.parse(stored)
      : { action, timestamps: [] };

    // Filter out old timestamps and add new one
    rateLimit.timestamps = rateLimit.timestamps
      .filter(ts => ts > oneMinuteAgo)
      .concat([now]);

    await AsyncStorage.setItem(key, JSON.stringify(rateLimit));
  } catch (error) {
    Logger.error('Error recording action:', error);
  }
}

/**
 * Reset all local limits (for testing/admin purposes)
 */
export async function resetLimits(): Promise<void> {
  try {
    // Clear all rate limit keys
    const allKeys = await AsyncStorage.getAllKeys();
    const rateLimitKeys = allKeys.filter(key => key.startsWith(RATE_LIMIT_KEY));
    if (rateLimitKeys.length > 0) {
      await AsyncStorage.multiRemove(rateLimitKeys);
    }
    Logger.info('Client limits reset');
  } catch (error) {
    Logger.error('Error resetting limits:', error);
  }
}
