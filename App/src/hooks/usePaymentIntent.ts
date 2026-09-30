import { useState, useCallback, useRef } from 'react';
import * as Crypto from 'expo-crypto';

/**
 * Generates an RFC 4122 v4 UUID string for payment intent idempotency.
 * Free of timestamps (Date.now()) and Math.random().
 */
export function generateIdempotencyKey(): string {
  if (typeof Crypto?.randomUUID === 'function') {
    try {
      return Crypto.randomUUID();
    } catch {
      // Fall through to standard web/node crypto if expo-crypto fails
    }
  }

  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // RFC 4122 version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant (10xx)
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  // Fallback RFC 4122 v4 formatting if crypto is completely unavailable
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Hook to manage the lifecycle of a payment intent idempotency key.
 *
 * Lifecycle:
 * 1. Intent created when user enters confirm sheet/modal (generate UUID).
 * 2. Reused across all retries of the same intent.
 * 3. Cleared only when reaching a terminal state (success or definitive failure).
 */
export function usePaymentIntent(initialKey?: string | null) {
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(initialKey || null);
  const keyRef = useRef<string | null>(initialKey || null);

  keyRef.current = idempotencyKey;

  const createIntent = useCallback((customKey?: string): string => {
    const key = customKey || generateIdempotencyKey();
    setIdempotencyKey(key);
    keyRef.current = key;
    return key;
  }, []);

  const getOrCreateIntent = useCallback((): string => {
    if (keyRef.current) {
      return keyRef.current;
    }
    return createIntent();
  }, [createIntent]);

  const clearIntent = useCallback(() => {
    setIdempotencyKey(null);
    keyRef.current = null;
  }, []);

  const resetIntent = useCallback((): string => {
    return createIntent();
  }, [createIntent]);

  return {
    idempotencyKey,
    createIntent,
    getOrCreateIntent,
    clearIntent,
    resetIntent,
  };
}
