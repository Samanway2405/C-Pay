import { Logger } from '../utils/logger';
import React, { useRef, useState } from 'react';

// Cloud backup setup screen: protects recovery and account continuity.
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { Button, OnboardingProgress, Screen, FormField, InfoBanner } from '../components';
import {
  createCloudWalletBackup,
  getRecoveryPasswordRules,
  validateRecoveryPassword,
} from '../services/cloudWalletBackup';
import { getWalletFromSession } from '../services/wallet';
import { getAuthenticatedWallet } from '../utils/biometric';
import { AlertManager } from '../utils/alert';
import { COLORS, SPACING, FONT_SIZES, BORDER_RADIUS, SHADOWS, createThemedStyles, useTheme } from '../constants/theme';

type CloudBackupSetupRouteParams = {
  fromSettings?: boolean;
};

interface CloudBackupSetupScreenProps {
  navigation: any;
  route?: {
    params?: CloudBackupSetupRouteParams;
  };
}

export const CloudBackupSetupScreen: React.FC<CloudBackupSetupScreenProps> = ({
  navigation,
  route,
}) => {
  useTheme();
  const fromSettings = route?.params?.fromSettings === true;
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const submittingRef = useRef(false);
  const passwordRules = getRecoveryPasswordRules(password);
  const passwordValidationError = password.length > 0 ? validateRecoveryPassword(password) : null;
  const passwordsDoNotMatch = confirmPassword.length > 0 && password !== confirmPassword;

  const handleSaveBackup = async () => {
    if (submittingRef.current) {
      return;
    }

    const validationError = validateRecoveryPassword(password);
    if (validationError) {
      setError(validationError);
      return;
    }

    if (password !== confirmPassword) {
      setError('Recovery passwords do not match.');
      return;
    }

    try {
      submittingRef.current = true;
      setLoading(true);
      setError('');

      const wallet = await getWalletFromSession() || await getAuthenticatedWallet(
        'Create Cloud Backup',
        'Enter your C-Pay PIN to encrypt your wallet backup',
        'Encrypt cloud wallet backup'
      );

      if (!wallet) {
        submittingRef.current = false;
        setLoading(false);
        AlertManager.alert(
          'Wallet Locked',
          'Unlock your wallet with PIN or biometric to create the cloud backup.',
          undefined,
          { type: 'warning' }
        );
        return;
      }

      await createCloudWalletBackup(wallet, password);
      await AsyncStorage.multiSet([
        ['cloud_backup_complete', 'true'],
        ['cloud_backup_required', 'false'],
      ]);

      if (fromSettings) {
        navigation.goBack();
      } else {
        navigation.replace('BiometricSetup');
      }
    } catch (backupError: any) {
      Logger.error('Cloud backup setup error:', backupError);
      submittingRef.current = false;
      setError(backupError?.message || 'Cloud backup could not be saved. Please try again.');
      setLoading(false);
    }
  };

  return (
    <Screen padded={false} contentContainerStyle={styles.content}>
      {!fromSettings && <OnboardingProgress currentStep={4} flowType="setup" />}
      <View style={styles.iconCircle}>
        <Ionicons name="cloud-done-outline" size={40} color={COLORS.primary} />
      </View>

      <Text style={styles.title}>
        {fromSettings ? 'Update Cloud Backup' : 'Secure Cloud Backup'}
      </Text>
      <Text style={styles.subtitle}>
        Create a recovery password to encrypt your wallet before it is stored in Supabase.
      </Text>

      <InfoBanner
        variant="info"
        icon="lock-closed-outline"
        message="Only encrypted wallet data is uploaded. C-Pay cannot read your secret key or reset this recovery password."
        style={styles.infoBox}
      />

      <View style={styles.formGroup}>
        <FormField
          label="Recovery Password"
          value={password}
          onChangeText={(value) => {
            setPassword(value);
            setError('');
          }}
          placeholder="At least 12 characters"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry={!showPassword}
          editable={!loading}
          error={passwordValidationError || undefined}
          rightAction={{
            icon: showPassword ? 'eye-off-outline' : 'eye-outline',
            onPress: () => setShowPassword((current) => !current),
            accessibilityLabel: showPassword ? 'Hide password' : 'Show password',
          }}
        />
        <View style={styles.ruleList}>
          {passwordRules.map((rule) => (
            <View key={rule.id} style={styles.ruleRow}>
              <Ionicons
                name={rule.passed ? 'checkbox-outline' : 'square-outline'}
                size={18}
                color={rule.passed ? COLORS.success : COLORS.textMuted}
                style={styles.ruleIcon}
              />
              <Text style={[styles.ruleText, rule.passed && styles.ruleTextPassed]}>
                {rule.label}
              </Text>
            </View>
          ))}
        </View>
      </View>

      <FormField
        containerStyle={styles.formGroup}
        label="Confirm Recovery Password"
        value={confirmPassword}
        onChangeText={(value) => {
          setConfirmPassword(value);
          setError('');
        }}
        placeholder="Re-enter password"
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry={!showPassword}
        editable={!loading}
        error={passwordsDoNotMatch ? 'Recovery passwords do not match.' : undefined}
      />

      {!!error && <Text style={styles.errorText}>{error}</Text>}

      <Button
        title={loading ? 'Saving Backup...' : 'Save Encrypted Backup'}
        onPress={handleSaveBackup}
        loading={loading}
        disabled={loading}
        fullWidth
        size="lg"
      />

      {loading && (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={COLORS.primary} />
          <Text style={styles.loadingText}>Encrypting wallet on this device...</Text>
        </View>
      )}

      <Text style={styles.footer}>
        Save this password somewhere safe. You will need it after clearing app data or moving to a new phone.
      </Text>
    </Screen>
  );
};

const styles = createThemedStyles((COLORS) => ({
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
  },
  iconCircle: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: COLORS.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: SPACING.lg,
  },
  title: {
    fontSize: FONT_SIZES.xxl,
    fontWeight: '800',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  subtitle: {
    fontSize: FONT_SIZES.md,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: SPACING.lg,
  },
  infoBox: {
    marginBottom: SPACING.xl,
  },
  formGroup: {
    marginBottom: SPACING.md,
  },
  ruleList: {
    marginTop: SPACING.sm,
    gap: 6,
  },
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ruleIcon: {
    marginRight: SPACING.xs,
  },
  ruleText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.textMuted,
  },
  ruleTextPassed: {
    color: COLORS.success,
    fontWeight: '600',
  },
  errorText: {
    color: COLORS.error,
    fontSize: FONT_SIZES.sm,
    textAlign: 'center',
    marginBottom: SPACING.md,
  },
  loadingRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: SPACING.sm,
    marginTop: SPACING.lg,
  },
  loadingText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
  },
  footer: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: SPACING.lg,
  },
}));
