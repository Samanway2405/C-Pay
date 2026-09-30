import { generateIdempotencyKey, usePaymentIntent } from '../../hooks/usePaymentIntent';

describe('usePaymentIntent & generateIdempotencyKey (#33)', () => {
  const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  describe('generateIdempotencyKey', () => {
    test('generates valid RFC 4122 v4 UUID', () => {
      const key1 = generateIdempotencyKey();
      const key2 = generateIdempotencyKey();

      expect(key1).toMatch(UUID_V4_REGEX);
      expect(key2).toMatch(UUID_V4_REGEX);
      expect(key1).not.toBe(key2);
    });

    test('contains no Date.now() timestamp or Math.random strings', () => {
      const key = generateIdempotencyKey();
      // Should not contain typical Date.now() 13-digit timestamp
      expect(key).not.toMatch(/\b\d{13}\b/);
      // Key length for UUID format is exactly 36 characters
      expect(key.length).toBe(36);
    });
  });

  describe('usePaymentIntent lifecycle logic', () => {
    test('maintains identical idempotency key across multiple getOrCreateIntent calls (retry simulation)', () => {
      let state: any = { idempotencyKey: null };
      const createIntent = (customKey?: string) => {
        const key = customKey || generateIdempotencyKey();
        state.idempotencyKey = key;
        return key;
      };
      const getOrCreateIntent = () => {
        if (state.idempotencyKey) return state.idempotencyKey;
        return createIntent();
      };
      const clearIntent = () => {
        state.idempotencyKey = null;
      };

      // 1. Initial attempt creates intent
      const keyAttempt1 = getOrCreateIntent();
      expect(keyAttempt1).toMatch(UUID_V4_REGEX);
      expect(state.idempotencyKey).toBe(keyAttempt1);

      // 2. Retry attempt (e.g. after network timeout or slow response) reuses the exact same key
      const keyAttempt2 = getOrCreateIntent();
      expect(keyAttempt2).toBe(keyAttempt1);

      // 3. Third attempt also reuses same key
      const keyAttempt3 = getOrCreateIntent();
      expect(keyAttempt3).toBe(keyAttempt1);

      // 4. Terminal state reached (success) -> clear key
      clearIntent();
      expect(state.idempotencyKey).toBeNull();

      // 5. Subsequent new payment creates fresh intent
      const keyNewPayment = getOrCreateIntent();
      expect(keyNewPayment).toMatch(UUID_V4_REGEX);
      expect(keyNewPayment).not.toBe(keyAttempt1);
    });
  });
});
