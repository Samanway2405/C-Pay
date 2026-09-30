/**
 * Unit tests for getPaymentFailureCopy.
 * Covers every named error code and the fallback path.
 */

import fs from 'fs';
import path from 'path';
import { getPaymentFailureCopy } from '../../utils/paymentFailure';

describe('getPaymentFailureCopy', () => {
  // ──────────────────────────────────────────────────────
  // AUTH_REQUIRED / JWT / authentication errors
  // ──────────────────────────────────────────────────────
  test('AUTH_REQUIRED code → session expired, support category', () => {
    const copy = getPaymentFailureCopy({ code: 'AUTH_REQUIRED' });
    expect(copy.errorMessage).toContain('Session');
    expect(copy.category).toBe('support');
    expect(copy.errorCode).toBe('AUTH_REQUIRED');
  });

  test('message containing "jwt" → session expired, support category', () => {
    const copy = getPaymentFailureCopy({ message: 'jwt expired' });
    expect(copy.category).toBe('support');
    expect(copy.errorMessage.toLowerCase()).toContain('session');
  });

  // ──────────────────────────────────────────────────────
  // Wallet ownership support codes
  // ──────────────────────────────────────────────────────
  test('WALLET_OWNERSHIP_DENIED code → wallet not recognised, support category', () => {
    const copy = getPaymentFailureCopy({ code: 'WALLET_OWNERSHIP_DENIED' });
    expect(copy.errorMessage).toBe('Wallet Not Recognised');
    expect(copy.errorReason).toContain('wallet that does not match your account');
    expect(copy.category).toBe('support');
    expect(copy.errorCode).toBe('WALLET_OWNERSHIP_DENIED');
  });

  test('CONTRACT_INTENT_SOURCE_MISMATCH → wallet mismatch, support category', () => {
    const copy = getPaymentFailureCopy({ code: 'CONTRACT_INTENT_SOURCE_MISMATCH' });
    expect(copy.errorMessage).toMatch(/wallet/i);
    expect(copy.category).toBe('support');
  });

  test('CONTRACT_INTENT_AMOUNT_MISMATCH → amount changed, support category', () => {
    const copy = getPaymentFailureCopy({ code: 'CONTRACT_INTENT_AMOUNT_MISMATCH' });
    expect(copy.errorMessage).toMatch(/amount/i);
    expect(copy.category).toBe('support');
  });

  // ──────────────────────────────────────────────────────
  // Retryable errors
  // ──────────────────────────────────────────────────────
  test('timeout message → retryable category', () => {
    const copy = getPaymentFailureCopy({ message: 'request timeout' });
    expect(copy.category).toBe('retryable');
    expect(copy.errorMessage).toMatch(/timeout|network/i);
  });

  test('RELAYER_TIMEOUT code → retryable category', () => {
    const copy = getPaymentFailureCopy({ code: 'RELAYER_TIMEOUT' });
    expect(copy.category).toBe('retryable');
  });

  test('insufficient balance message → retryable category', () => {
    const copy = getPaymentFailureCopy({ message: 'insufficient balance' });
    expect(copy.category).toBe('retryable');
    expect(copy.errorMessage).toMatch(/balance/i);
  });

  test('STELLAR_OP_UNDERFUNDED code → retryable category', () => {
    const copy = getPaymentFailureCopy({ code: 'STELLAR_OP_UNDERFUNDED' });
    expect(copy.category).toBe('retryable');
  });

  test('network fetch failure → retryable category', () => {
    const copy = getPaymentFailureCopy({ message: 'failed to fetch' });
    expect(copy.category).toBe('retryable');
    expect(copy.errorMessage).toMatch(/network|connection/i);
  });

  test('RELAYER_UNREACHABLE code → retryable category', () => {
    const copy = getPaymentFailureCopy({ code: 'RELAYER_UNREACHABLE' });
    expect(copy.category).toBe('retryable');
  });

  test('service unavailable message → retryable category', () => {
    const copy = getPaymentFailureCopy({ message: 'service unavailable' });
    expect(copy.category).toBe('retryable');
  });

  test('PAYMENT_AMOUNT_EXCEEDED → amount exceeds limit, support category', () => {
    const copy = getPaymentFailureCopy({ code: 'PAYMENT_AMOUNT_EXCEEDED' });
    expect(copy.errorMessage).toBe('Amount Exceeds Limit');
    expect(copy.category).toBe('support');
    expect(copy.errorCode).toBe('PAYMENT_AMOUNT_EXCEEDED');
  });

  test('PAYMENT_DAILY_CAP_EXCEEDED → daily payment limit reached, retryable category', () => {
    const copy = getPaymentFailureCopy({ code: 'PAYMENT_DAILY_CAP_EXCEEDED' });
    expect(copy.errorMessage).toBe('Daily Payment Limit Reached');
    expect(copy.category).toBe('retryable');
    expect(copy.errorCode).toBe('PAYMENT_DAILY_CAP_EXCEEDED');
  });

  test('PAYMENT_DAILY_COUNT_EXCEEDED → daily transaction limit reached, retryable category', () => {
    const copy = getPaymentFailureCopy({ code: 'PAYMENT_DAILY_COUNT_EXCEEDED' });
    expect(copy.errorMessage).toBe('Daily Transaction Limit Reached');
    expect(copy.category).toBe('retryable');
    expect(copy.errorCode).toBe('PAYMENT_DAILY_COUNT_EXCEEDED');
  });

  test('PAYMENT_VELOCITY_EXCEEDED → too many transactions, retryable category', () => {
    const copy = getPaymentFailureCopy({ code: 'PAYMENT_VELOCITY_EXCEEDED' });
    expect(copy.errorMessage).toBe('Too Many Transactions');
    expect(copy.category).toBe('retryable');
    expect(copy.errorCode).toBe('PAYMENT_VELOCITY_EXCEEDED');
  });

  test('PAYMENT_LIMITS_UNAVAILABLE → limits service unavailable, retryable category', () => {
    const copy = getPaymentFailureCopy({ code: 'PAYMENT_LIMITS_UNAVAILABLE' });
    expect(copy.errorMessage).toBe('Limits Service Unavailable');
    expect(copy.category).toBe('retryable');
    expect(copy.errorCode).toBe('PAYMENT_LIMITS_UNAVAILABLE');
  });

  // ──────────────────────────────────────────────────────
  // Error detail extraction paths
  // ──────────────────────────────────────────────────────
  test('reads error text from details.error when present', () => {
    const copy = getPaymentFailureCopy({ details: { error: 'insufficient balance' } });
    expect(copy.category).toBe('retryable');
  });

  test('reads error code from details.code when present', () => {
    const copy = getPaymentFailureCopy({ details: { code: 'AUTH_REQUIRED', error: 'auth' } });
    expect(copy.category).toBe('support');
  });

  // ──────────────────────────────────────────────────────
  // Fallback for unknown errors
  // ──────────────────────────────────────────────────────
  test('unknown error → generic fallback, retryable category', () => {
    const copy = getPaymentFailureCopy({ message: 'something went wrong' });
    expect(copy.category).toBe('retryable');
    expect(copy.errorMessage).toBeTruthy();
  });

  test('null error → generic fallback, retryable category', () => {
    const copy = getPaymentFailureCopy(null);
    expect(copy.category).toBe('retryable');
    expect(copy.errorMessage).toBeTruthy();
    expect(copy.errorReason).toBeTruthy();
  });

  test('empty object → generic fallback, retryable category', () => {
    const copy = getPaymentFailureCopy({});
    expect(copy.category).toBe('retryable');
  });

  // ──────────────────────────────────────────────────────
  // Shape of returned object
  // ──────────────────────────────────────────────────────
  test('always returns errorMessage and errorReason strings', () => {
    const copy = getPaymentFailureCopy({ code: 'UNKNOWN_CODE' });
    expect(typeof copy.errorMessage).toBe('string');
    expect(typeof copy.errorReason).toBe('string');
    expect(copy.errorMessage.length).toBeGreaterThan(0);
    expect(copy.errorReason.length).toBeGreaterThan(0);
  });

  // ──────────────────────────────────────────────────────
  // Deleted unreachable codes have no dedicated mapping
  // ──────────────────────────────────────────────────────
  test('unreachable merchant/contract codes have no dedicated mapping and fall back', () => {
    const deletedCodes = [
      'MERCHANT_OWNERSHIP_DENIED',
      'CONTRACT_MERCHANT_MISSING',
      'CONTRACT_MERCHANT_INACTIVE',
      'CONTRACT_MERCHANT_MISMATCH',
    ];

    for (const code of deletedCodes) {
      const copy = getPaymentFailureCopy({ code });
      expect(copy.errorMessage).toBe('Transaction Failed');
      expect(copy.errorReason).toContain('The payment could not be completed.');
    }
  });

  // ──────────────────────────────────────────────────────
  // Relayer emission parity & drift prevention
  // ──────────────────────────────────────────────────────
  describe('relayer error code mapping parity', () => {
    const KNOWN_RELAYER_CODES = [
      'AUTH_REQUIRED',
      'WALLET_OWNERSHIP_DENIED',
      'WALLET_OWNERSHIP_UNAVAILABLE',
      'WALLET_BINDING_FAILED',
      'SPONSORSHIP_LIMIT_EXCEEDED',
      'IDEMPOTENCY_IN_FLIGHT',
      'ADD_MONEY_DISABLED',
      'ADD_MONEY_PERSISTENCE_UNAVAILABLE',
      'ADD_MONEY_IN_FLIGHT',
      'ADD_MONEY_COOLDOWN',
      'ADD_MONEY_DAILY_CAP_EXCEEDED',
      'ACCOUNT_NOT_READY',
      'DISTRIBUTION_LOW_ASSET',
      'NO_WALLETS_BOUND',
      'PAYMENT_AMOUNT_EXCEEDED',
      'PAYMENT_DAILY_CAP_EXCEEDED',
      'PAYMENT_DAILY_COUNT_EXCEEDED',
      'PAYMENT_VELOCITY_EXCEEDED',
      'PAYMENT_LIMITS_UNAVAILABLE',
    ];

    const getRelayerEmittedCodes = (): string[] => {
      const codes = new Set<string>(KNOWN_RELAYER_CODES);
      try {
        const serverJsPath = path.resolve(__dirname, '../../../../relayer-service/server.js');
        if (fs.existsSync(serverJsPath)) {
          const source = fs.readFileSync(serverJsPath, 'utf8');
          const codeMatches = source.matchAll(/code:\s*['"]([A-Z0-9_]+)['"]/g);
          for (const m of codeMatches) {
            if (m[1] && m[1] !== 'USDC') {
              codes.add(m[1]);
            }
          }
          const helperMatches = source.matchAll(/sendWalletOwnershipUnavailable\([^)]*['"]([A-Z0-9_]+)['"]/g);
          for (const m of helperMatches) {
            codes.add(m[1]);
          }
          const paramMatches = source.matchAll(/code\s*=\s*['"]([A-Z0-9_]+)['"]/g);
          for (const m of paramMatches) {
            codes.add(m[1]);
          }
        }
      } catch {
        // Fallback to KNOWN_RELAYER_CODES if filesystem is restricted
      }
      return Array.from(codes);
    };

    const relayerCodes = getRelayerEmittedCodes();

    test('relayer codes list is not empty and includes WALLET_OWNERSHIP_DENIED', () => {
      expect(relayerCodes.length).toBeGreaterThan(0);
      expect(relayerCodes).toContain('WALLET_OWNERSHIP_DENIED');
      expect(relayerCodes).toContain('AUTH_REQUIRED');
    });

    test.each(relayerCodes)('relayer code %s has a dedicated user-facing message', (code) => {
      const copy = getPaymentFailureCopy({ code });
      expect(copy.errorCode).toBe(code);
      expect(copy.errorMessage).toBeTruthy();
      expect(copy.errorReason).toBeTruthy();
      expect(copy.errorMessage).not.toBe('Transaction Failed');
      expect(copy.errorReason).not.toContain('The payment could not be completed.');
    });
  });
});
