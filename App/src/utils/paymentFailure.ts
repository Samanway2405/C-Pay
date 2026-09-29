/**
 * How the user can recover from a payment failure:
 * - `retryable`: a plain retry is likely to succeed (network/timeout/service).
 * - `support`: retrying won't help on its own — the user needs to fix
 *   something (re-auth, wallet setup) or contact support.
 */
export type PaymentFailureCategory = 'retryable' | 'support';

export type PaymentFailureCopy = {
  errorMessage: string;
  errorReason: string;
  errorCode?: string;
  category: PaymentFailureCategory;
};

// Error codes / signals that a plain retry will not resolve.
const SUPPORT_CODES = new Set([
  'AUTH_REQUIRED',
  'WALLET_OWNERSHIP_DENIED',
  'NO_WALLETS_BOUND',
  'SPONSORSHIP_LIMIT_EXCEEDED',
  'ADD_MONEY_DISABLED',
  'RELAYER_URL_MISSING',
  'CONTRACT_INTENT_SOURCE_MISMATCH',
  'CONTRACT_INTENT_AMOUNT_MISMATCH',
]);

const classifyCategory = (errorCode: string | undefined, lowerMessage: string): PaymentFailureCategory => {
  if (errorCode && SUPPORT_CODES.has(errorCode)) return 'support';
  if (
    lowerMessage.includes('jwt') ||
    lowerMessage.includes('authentication') ||
    lowerMessage.includes('does not match the contract intent amount')
  ) {
    return 'support';
  }
  return 'retryable';
};

const safeNoDeductionText = 'Your USDC is safe - no amount was deducted.';

const getErrorText = (error: any): string => {
  const candidates = [
    error?.details?.error,
    error?.details?.message,
    error?.message,
    typeof error === 'string' ? error : '',
  ];

  return candidates.find((value) => typeof value === 'string' && value.trim())?.trim() || '';
};

const getErrorCode = (error: any): string | undefined => {
  const code = error?.code || error?.details?.code;
  return typeof code === 'string' && code.trim() ? code.trim() : undefined;
};

const buildFailureCopy = (error: any): Omit<PaymentFailureCopy, 'category'> => {
  const rawMessage = getErrorText(error);
  const lowerMessage = rawMessage.toLowerCase();
  const errorCode = getErrorCode(error);

  if (errorCode === 'AUTH_REQUIRED' || lowerMessage.includes('jwt') || lowerMessage.includes('authentication')) {
    return {
      errorMessage: 'Session Expired',
      errorReason: 'Your email session expired before the payment could be submitted. Sign in again, then retry the payment.',
      errorCode,
    };
  }

  if (errorCode === 'WALLET_OWNERSHIP_DENIED') {
    return {
      errorMessage: 'Wallet Not Recognised',
      errorReason: 'The payment was sent from a wallet that does not match your account. Sign out, sign back in, and try again.',
      errorCode,
    };
  }

  if (errorCode === 'WALLET_OWNERSHIP_UNAVAILABLE') {
    return {
      errorMessage: 'Wallet Service Unavailable',
      errorReason: `Wallet ownership service is temporarily unavailable. ${safeNoDeductionText} Please try again in a few moments.`,
      errorCode,
    };
  }

  if (errorCode === 'NO_WALLETS_BOUND') {
    return {
      errorMessage: 'No Wallet Linked',
      errorReason: 'No wallet is linked to your account. Set up or link a wallet before submitting transactions.',
      errorCode,
    };
  }

  if (errorCode === 'WALLET_BINDING_FAILED') {
    return {
      errorMessage: 'Wallet Setup Failed',
      errorReason: `Failed to link wallet to your account. ${safeNoDeductionText} Please try again.`,
      errorCode,
    };
  }

  if (errorCode === 'SPONSORSHIP_LIMIT_EXCEEDED') {
    return {
      errorMessage: 'Sponsorship Limit Reached',
      errorReason: 'You have reached the maximum number of sponsored accounts for this user.',
      errorCode,
    };
  }

  if (errorCode === 'IDEMPOTENCY_IN_FLIGHT') {
    return {
      errorMessage: 'Payment In Progress',
      errorReason: 'A transaction request is already being processed. Please wait a few moments before trying again.',
      errorCode,
    };
  }

  if (errorCode === 'ADD_MONEY_DISABLED') {
    return {
      errorMessage: 'Add Money Disabled',
      errorReason: 'Add Money is currently disabled for this network.',
      errorCode,
    };
  }

  if (errorCode === 'ADD_MONEY_PERSISTENCE_UNAVAILABLE') {
    return {
      errorMessage: 'Service Unavailable',
      errorReason: `Add Money persistence is temporarily unavailable. ${safeNoDeductionText} Please try again in a few moments.`,
      errorCode,
    };
  }

  if (errorCode === 'ADD_MONEY_IN_FLIGHT') {
    return {
      errorMessage: 'Request In Progress',
      errorReason: 'An Add Money request is already in progress for this account. Please wait a few moments.',
      errorCode,
    };
  }

  if (errorCode === 'ADD_MONEY_COOLDOWN') {
    return {
      errorMessage: 'Cooldown Active',
      errorReason: 'Add Money is cooling down for this account. Please try again later.',
      errorCode,
    };
  }

  if (errorCode === 'ADD_MONEY_DAILY_CAP_EXCEEDED') {
    return {
      errorMessage: 'Daily Limit Reached',
      errorReason: 'The daily Add Money limit has been reached for this account. Please try again later.',
      errorCode,
    };
  }

  if (errorCode === 'ACCOUNT_NOT_READY') {
    return {
      errorMessage: 'Account Not Ready',
      errorReason: 'The account is not ready to receive balance yet. Please try again in a few moments.',
      errorCode,
    };
  }

  if (errorCode === 'DISTRIBUTION_LOW_ASSET') {
    return {
      errorMessage: 'Service Unavailable',
      errorReason: `The distribution account has insufficient funds to fulfill this request. ${safeNoDeductionText} Please try again later.`,
      errorCode,
    };
  }

  if (errorCode === 'RELAYER_URL_MISSING') {
    return {
      errorMessage: 'Configuration Error',
      errorReason: 'Payment service URL is not configured. Please contact support.',
      errorCode,
    };
  }

  if (errorCode === 'CONTRACT_INTENT_SOURCE_MISMATCH') {
    return {
      errorMessage: 'Wallet Mismatch',
      errorReason: 'The payment was signed by a different wallet than the one used to create the payment request. Unlock the correct wallet and try again.',
      errorCode,
    };
  }

  if (errorCode === 'CONTRACT_INTENT_AMOUNT_MISMATCH' || lowerMessage.includes('does not match the contract intent amount')) {
    return {
      errorMessage: 'Payment Amount Changed',
      errorReason: `The QR payment request was created for a different amount than the payment being sent. ${safeNoDeductionText} Ask the merchant to generate a fresh QR code, then try again.`,
      errorCode,
    };
  }

  if (
    lowerMessage.includes('timeout') ||
    lowerMessage.includes('taking too long') ||
    lowerMessage.includes('slow') ||
    errorCode === 'RELAYER_TIMEOUT'
  ) {
    return {
      errorMessage: 'Network Timeout',
      errorReason: `The payment service took too long to respond. ${safeNoDeductionText} Please try again in a few moments.`,
      errorCode,
    };
  }

  if (
    lowerMessage.includes('insufficient') ||
    errorCode === 'STELLAR_OP_UNDERFUNDED' ||
    errorCode === 'STELLAR_TX_INSUFFICIENT_BALANCE'
  ) {
    return {
      errorMessage: 'Insufficient Balance',
      errorReason: 'You do not have enough USDC or network balance to complete this payment.',
      errorCode,
    };
  }

  if (
    lowerMessage.includes('not reachable') ||
    lowerMessage.includes('failed to fetch') ||
    lowerMessage.includes('network') ||
    errorCode === 'RELAYER_UNREACHABLE'
  ) {
    return {
      errorMessage: 'Network Connection Failed',
      errorReason: 'The app could not reach the payment service. Check your internet connection and try again.',
      errorCode,
    };
  }

  if (lowerMessage.includes('temporarily unavailable') || lowerMessage.includes('service unavailable')) {
    return {
      errorMessage: 'Service Unavailable',
      errorReason: `Payment service is temporarily unavailable. ${safeNoDeductionText} Please try again in a few moments.`,
      errorCode,
    };
  }

  if (lowerMessage.includes('fee')) {
    return {
      errorMessage: 'Network Issue',
      errorReason: 'The payment network could not accept the transaction fee. Please try again later.',
      errorCode,
    };
  }

  if (rawMessage) {
    return {
      errorMessage: 'Transaction Failed',
      errorReason: `${rawMessage}. ${safeNoDeductionText}`,
      errorCode,
    };
  }

  return {
    errorMessage: 'Transaction Failed',
    errorReason: `The payment could not be completed. ${safeNoDeductionText} Please try again in a few moments.`,
    errorCode,
  };
};

export const getPaymentFailureCopy = (error: any): PaymentFailureCopy => {
  const base = buildFailureCopy(error);
  const errorCode = getErrorCode(error);
  const lowerMessage = getErrorText(error).toLowerCase();
  return { ...base, category: classifyCategory(errorCode, lowerMessage) };
};
