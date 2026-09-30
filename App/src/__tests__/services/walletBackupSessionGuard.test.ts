/**
 * Issue #32 — merchant registration silently destroyed the user's cloud wallet backup.
 *
 * The old flow called supabase.auth.signInWithOtp({ shouldCreateUser: true })
 * with the *business* email while the wallet owner was already signed in, then
 * verified it. That minted a session for a different auth user, changing
 * auth.uid(). Because wallet_backups is UNIQUE(auth_user_id) with RLS scoped to
 * auth.uid(), the user's encrypted seed became unreachable — their only wallet
 * recovery path, gone silently.
 *
 * These tests pin the guard: no code path may swap the auth session while a
 * wallet backup is bound to the current auth.uid().
 */

import {
  getSessionSwapBlockReason,
  sendLoginEmailOTP,
  verifyLoginEmailOTP,
} from '../../services/auth';
import * as authModule from '../../services/auth';
import { supabase } from '../../services/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

const OWNER_EMAIL = 'owner@example.com';
const OWNER_AUTH_ID = '00000000-0000-4000-8000-000000000001';
const BUSINESS_EMAIL = 'business@example.com';

/** Signed in as the wallet owner. */
function givenSignedInAs(email: string, id = OWNER_AUTH_ID) {
  (supabase.auth.getSession as jest.Mock).mockResolvedValue({
    data: { session: { user: { id, email } } },
    error: null,
  });
}

function givenNoSession() {
  (supabase.auth.getSession as jest.Mock).mockResolvedValue({
    data: { session: null },
    error: null,
  });
}

/** The wallet_backups row bound to the current auth.uid(), or none. */
function givenWalletBackup(backup: { id: string } | null, error: unknown = null) {
  (supabase.from as jest.Mock).mockImplementation((table: string) => {
    if (table === 'wallet_backups') {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: backup, error }),
      };
    }
    return {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    };
  });
}

describe('wallet backup session-swap guard (issue #32)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
    (supabase.auth.signInWithOtp as jest.Mock).mockResolvedValue({ data: {}, error: null });
    (supabase.auth.verifyOtp as jest.Mock).mockResolvedValue({
      data: { user: { id: 'other-auth-id', email: BUSINESS_EMAIL } },
      error: null,
    });
  });

  test('the session-minting merchant OTP pair no longer exists', () => {
    // sendEmailOTP / verifyEmailOTP were the exact functions that swapped the
    // session on the business email. They must not come back.
    expect((authModule as Record<string, unknown>).sendEmailOTP).toBeUndefined();
    expect((authModule as Record<string, unknown>).verifyEmailOTP).toBeUndefined();
    expect((authModule as Record<string, unknown>).sendMerchantContactOtp).toBeUndefined();
    expect((authModule as Record<string, unknown>).verifyMerchantContactOtp).toBeUndefined();
  });

  test('blocks a second-email OTP when a backup is bound to the current session', async () => {
    givenSignedInAs(OWNER_EMAIL);
    givenWalletBackup({ id: 'backup-1' });

    const reason = await getSessionSwapBlockReason(BUSINESS_EMAIL);

    expect(reason).not.toBeNull();
    expect(reason).toMatch(/wallet backup/i);
    expect(reason).toContain(BUSINESS_EMAIL);
  });

  test('repro: registering with a second email does not send or verify an OTP', async () => {
    givenSignedInAs(OWNER_EMAIL);
    givenWalletBackup({ id: 'backup-1' });

    const sent = await sendLoginEmailOTP(BUSINESS_EMAIL);
    expect(sent.success).toBe(false);
    expect(supabase.auth.signInWithOtp).not.toHaveBeenCalled();

    // Even if a code were obtained out of band, verification is refused, so the
    // session is never replaced and the backup stays bound to OWNER_AUTH_ID.
    const verified = await verifyLoginEmailOTP(BUSINESS_EMAIL, '123456');
    expect(verified.success).toBe(false);
    expect(supabase.auth.verifyOtp).not.toHaveBeenCalled();
  });

  test('allows onboarding when there is no session to displace', async () => {
    givenNoSession();
    givenWalletBackup(null);

    expect(await getSessionSwapBlockReason(BUSINESS_EMAIL)).toBeNull();
  });

  test('allows re-verifying the same email — auth.uid() is unchanged', async () => {
    givenSignedInAs(OWNER_EMAIL);
    givenWalletBackup({ id: 'backup-1' });

    expect(await getSessionSwapBlockReason(OWNER_EMAIL)).toBeNull();
    expect(await getSessionSwapBlockReason(' OWNER@Example.com ')).toBeNull();
  });

  test('allows a different email when no backup is bound yet', async () => {
    givenSignedInAs(OWNER_EMAIL);
    givenWalletBackup(null);

    expect(await getSessionSwapBlockReason(BUSINESS_EMAIL)).toBeNull();
  });

  test('fails closed when the backup lookup errors', async () => {
    givenSignedInAs(OWNER_EMAIL);
    givenWalletBackup(null, { message: 'network down' });

    const reason = await getSessionSwapBlockReason(BUSINESS_EMAIL);
    expect(reason).not.toBeNull();
  });
});
