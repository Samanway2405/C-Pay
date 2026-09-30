import { Logger } from '../utils/logger';
import React, { useState, useEffect, useRef, useCallback } from 'react';

// Login screen: secure wallet access via PIN or biometric unlock.
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { PINInput } from '../components/PINInput';
import { Screen } from '../components';
import {
  attemptsUntilWipe,
  cachePinForSession,
  clearPinAttempts,
  getWalletFromBiometricBackup,
  getPinAttemptState,
  hasBiometricBackup,
  isLockedOut,
  lockoutRemainingMs,
  MAX_PIN_ATTEMPTS,
  MAX_LOCKOUT_MS,
  recordFailedPinAttempt,
  shouldWarnAboutWipe,
  shouldWipeWallet,
  verifyPin,
  wipeWalletAfterFailedAttempts,
  WIPE_PIN_ATTEMPTS,
} from '../services/wallet';
import { isBiometricAvailable, getBiometricType } from '../utils/biometric';
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS, createThemedStyles, useTheme } from '../constants/theme';
import { AlertManager } from '../utils/alert';

const FONT_SIZES = TYPOGRAPHY.sizes;

interface LoginScreenProps {
  navigation: any;
}

/** Format remaining lockout seconds as mm:ss. */
function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ navigation }) => {
  useTheme();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showBiometric, setShowBiometric] = useState(false);
  const [biometricType, setBiometricType] = useState('Biometric');

  // Lockout state
  const [attemptCount, setAttemptCount] = useState(0);
  const [lockoutMs, setLockoutMs] = useState(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const biometricIconName = biometricType.includes('Face') ? 'scan-outline' : 'finger-print-outline';
  const locked = lockoutMs > 0;

  // ── Load persisted attempt state on mount ──────────────────────────────────
  useEffect(() => {
    void (async () => {
      const result = await getPinAttemptState();
      if (result.status === 'unknown') {
        setLockoutMs(MAX_LOCKOUT_MS);
        startCountdown();
        return;
      }
      const state = result.state;
      setAttemptCount(state.attempts);
      const remaining = lockoutRemainingMs(state);
      if (remaining > 0) {
        setLockoutMs(remaining);
        startCountdown();
      }
    })();
    checkAndTriggerBiometric();
  }, []);

  // ── Countdown ticker ───────────────────────────────────────────────────────
  const startCountdown = useCallback(() => {
    if (countdownRef.current) return;
    countdownRef.current = setInterval(async () => {
      const result = await getPinAttemptState();
      if (result.status === 'unknown') {
        setLockoutMs(MAX_LOCKOUT_MS);
        return;
      }
      const state = result.state;
      const remaining = lockoutRemainingMs(state);
      setLockoutMs(remaining);
      if (remaining <= 0) {
        clearInterval(countdownRef.current!);
        countdownRef.current = null;
        setLockoutMs(0);
        setError('');
      }
    }, 500);
  }, []);

  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  // ── Biometric ──────────────────────────────────────────────────────────────
  const checkAndTriggerBiometric = async () => {
    const biometricEnabled = await AsyncStorage.getItem('biometric_enabled');
    const available = await isBiometricAvailable();
    const backupAvailable = await hasBiometricBackup();

    if (biometricEnabled === 'true' && available && backupAvailable) {
      setShowBiometric(true);
      const type = await getBiometricType();
      setBiometricType(type);
      setTimeout(() => handleBiometricAuth(), 500);
    }
  };

  const navigateAfterWalletUnlock = async () => {
    const cloudBackupRequired = await AsyncStorage.getItem('cloud_backup_required');
    navigation.replace(cloudBackupRequired === 'true' ? 'CloudBackupSetup' : 'MainTabs');
  };

  const handleBiometricAuth = async () => {
    try {
      const available = await isBiometricAvailable();
      if (!available) {
        AlertManager.alert('Biometric Not Available', 'Please use your PIN to login');
        return;
      }

      const wallet = await getWalletFromBiometricBackup('Unlock C-Pay wallet');
      const expectedWallet = await AsyncStorage.getItem('wallet_address');

      if (wallet && (!expectedWallet || wallet.address === expectedWallet)) {
        await navigateAfterWalletUnlock();
      } else {
        AlertManager.alert('Authentication Failed', 'Please use your PIN to unlock this wallet.');
      }
    } catch (err) {
// [SECURITY] Removed sensitive log: console.error('Biometric auth error:', err);
      AlertManager.alert('Authentication Failed', 'Please use your PIN to unlock this wallet.');
    }
  };

  // ── PIN entry ──────────────────────────────────────────────────────────────
  const handlePINChange = (newPin: string) => {
    if (loading || locked) return;
    setPin(newPin);
    setError('');
    if (newPin.length === 6) {
      void verifyPinAndLogin(newPin);
    }
  };

  const verifyPinAndLogin = async (pinToVerify: string) => {
    if (loading || locked) return;
    setLoading(true);

    try {
      // Re-check lockout state right before verifying (prevents race conditions).
      const currentResult = await getPinAttemptState();
      if (currentResult.status === 'unknown') {
        setLockoutMs(MAX_LOCKOUT_MS);
        startCountdown();
        setPin('');
        setLoading(false);
        return;
      }
      const currentState = currentResult.state;
      if (isLockedOut(currentState)) {
        const remaining = lockoutRemainingMs(currentState);
        setLockoutMs(remaining);
        startCountdown();
        setPin('');
        setLoading(false);
        return;
      }

      const result = await verifyPin(pinToVerify, { blockMigration: false });

      if (result.success) {
        await clearPinAttempts();
        setAttemptCount(0);
        setLockoutMs(0);
        cachePinForSession(pinToVerify);
        await navigateAfterWalletUnlock();
      } else if (result.error === 'STORAGE_ERROR') {
        setError("Couldn't access secure storage — try again.");
        setPin('');
      } else {
        const nextState = await recordFailedPinAttempt();
        setAttemptCount(nextState.attempts);

        // Wipe threshold reached: erase local wallet state and send the user to
        // recovery. Checked before lockout messaging — once we wipe, there is
        // nothing left to lock out.
        if (shouldWipeWallet(nextState)) {
          await wipeWalletAfterFailedAttempts();
          setPin('');
          setLoading(false);
          AlertManager.alert(
            'Wallet erased from this device',
            `After ${WIPE_PIN_ATTEMPTS} incorrect PIN attempts, the wallet has been removed from this device to protect it.\n\n` +
              'Your account and funds are safe. If you saved an encrypted cloud backup, restore it with your email and recovery password. ' +
              'Without a cloud backup this wallet cannot be recovered.',
            [{ text: 'Restore wallet', onPress: () => navigation.replace('Onboarding') }],
          );
          return;
        }

        const remaining = lockoutRemainingMs(nextState);
        if (remaining > 0) {
          setLockoutMs(remaining);
          startCountdown();
          setError('Too many incorrect attempts. Please wait before trying again.');
        } else {
          const attemptsLeft = MAX_PIN_ATTEMPTS - nextState.attempts;
          if (attemptsLeft > 0) {
            setError(`Incorrect PIN. ${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} remaining before lockout.`);
          } else {
            setError('Incorrect PIN.');
          }
        }
        setPin('');
      }
    } catch (err) {
      setError('Failed to verify PIN');
      setPin('');
    } finally {
      setLoading(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <Screen scroll={false}>
      <View style={styles.header}>
        <Image
          source={require('../../assets/cpay_logo.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.title}>Welcome Back</Text>
        <Text style={styles.subtitle}>Enter your PIN to continue</Text>
      </View>

      <View style={styles.pinSection}>
        <PINInput
          value={pin}
          onChange={handlePINChange}
          error={locked ? '' : error}
          autoFocus={!showBiometric && !locked}
          disabled={loading || locked}
        />

        {loading && (
          <View style={styles.statusRow}>
            <ActivityIndicator size="small" color={COLORS.primary} />
            <Text style={styles.statusText}>Verifying PIN…</Text>
          </View>
        )}

        {/* Lockout banner */}
        {locked && (
          <View style={styles.lockoutBanner}>
            <Ionicons name="lock-closed-outline" size={20} color={COLORS.error} style={styles.lockoutIcon} />
            <View style={styles.lockoutTextBlock}>
              <Text style={styles.lockoutTitle}>Account temporarily locked</Text>
              <Text style={styles.lockoutBody}>
                Too many incorrect attempts. Try again in{' '}
                <Text style={styles.lockoutCountdown}>{formatCountdown(lockoutMs)}</Text>.
              </Text>
            </View>
          </View>
        )}

        {/* Attempt warning — show only when not locked and some attempts used */}
        {!locked && attemptCount > 0 && attemptCount < MAX_PIN_ATTEMPTS && (
          <View style={styles.warningBanner}>
            <Ionicons name="warning-outline" size={16} color={COLORS.warning} />
            <Text style={styles.warningText}>
              {MAX_PIN_ATTEMPTS - attemptCount} attempt{MAX_PIN_ATTEMPTS - attemptCount === 1 ? '' : 's'} remaining before lockout
            </Text>
          </View>
        )}

        {/* Impending-wipe warning — surfaced before the threshold, never at it,
            because a user without a cloud backup loses the wallet for good. */}
        {shouldWarnAboutWipe({ attempts: attemptCount, lockedUntil: 0 }) && (
          <View style={styles.wipeWarningBanner}>
            <Ionicons name="alert-circle-outline" size={20} color={COLORS.error} style={styles.lockoutIcon} />
            <View style={styles.lockoutTextBlock}>
              <Text style={styles.wipeWarningTitle}>
                {attemptsUntilWipe({ attempts: attemptCount, lockedUntil: 0 })} attempt
                {attemptsUntilWipe({ attempts: attemptCount, lockedUntil: 0 }) === 1 ? '' : 's'} before this wallet is erased
              </Text>
              <Text style={styles.wipeWarningBody}>
                After {WIPE_PIN_ATTEMPTS} incorrect attempts the wallet is removed from this device.
                You will need your cloud backup and recovery password to restore it.
              </Text>
            </View>
          </View>
        )}
      </View>

      {showBiometric && !locked && (
        <TouchableOpacity
          style={styles.biometricButton}
          onPress={handleBiometricAuth}
        >
          <Ionicons name={biometricIconName as any} size={20} color={COLORS.primary} style={styles.biometricIcon} />
          <Text style={styles.biometricText}>Use {biometricType}</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={styles.forgotPinButton}
        onPress={() => navigation.navigate('ForgotPIN')}
      >
        <Text style={styles.forgotPinText}>Forgot PIN?</Text>
      </TouchableOpacity>
    </Screen>
  );
};

const styles = createThemedStyles((COLORS) => ({
  header: {
    alignItems: 'center',
    marginTop: SPACING.xxl,
    marginBottom: SPACING.xl * 2,
  },
  logo: {
    width: 100,
    height: 100,
    borderRadius: 50,
    marginBottom: SPACING.lg,
  },
  title: {
    fontSize: FONT_SIZES.xxl,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: SPACING.sm,
  },
  subtitle: {
    fontSize: FONT_SIZES.md,
    color: COLORS.textMuted,
  },
  pinSection: {
    marginBottom: SPACING.xl,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SPACING.md,
  },
  statusText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    marginLeft: SPACING.sm,
  },
  lockoutBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: COLORS.errorBg,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.error + '40',
    padding: SPACING.md,
    marginTop: SPACING.lg,
    gap: SPACING.sm,
  },
  lockoutIcon: {
    marginTop: 2,
  },
  lockoutTextBlock: {
    flex: 1,
  },
  lockoutTitle: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '700',
    color: COLORS.error,
    marginBottom: SPACING.xs,
  },
  lockoutBody: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.errorDark,
    lineHeight: 20,
  },
  lockoutCountdown: {
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  wipeWarningBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: COLORS.errorBg,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.error,
    padding: SPACING.md,
    marginTop: SPACING.md,
    gap: SPACING.sm,
  },
  wipeWarningTitle: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '700',
    color: COLORS.error,
    marginBottom: SPACING.xs,
  },
  wipeWarningBody: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.errorDark,
    lineHeight: 20,
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    backgroundColor: COLORS.warningBg,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.warning + '40',
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    marginTop: SPACING.md,
  },
  warningText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.warningDark,
    flex: 1,
  },
  biometricButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    alignSelf: 'center',
    borderRadius: 999,
    backgroundColor: COLORS.primaryLight,
  },
  biometricIcon: {
    marginRight: SPACING.sm,
  },
  biometricText: {
    fontSize: FONT_SIZES.md,
    color: COLORS.primary,
    fontWeight: '600',
  },
  forgotPinButton: {
    alignItems: 'center',
    paddingVertical: SPACING.md,
    marginTop: SPACING.md,
  },
  forgotPinText: {
    fontSize: FONT_SIZES.md,
    color: COLORS.primary,
    fontWeight: '500',
  },
}));
