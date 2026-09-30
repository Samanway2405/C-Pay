import { Logger } from '../utils/logger';
import React, { useState, useEffect } from 'react';

// Biometric setup screen: security onboarding flow for wallet access.
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { isBiometricAvailable, getBiometricType, enableBiometric } from '../utils/biometric';
import { supabase } from '../services/supabase';
import { COLORS, SPACING, TYPOGRAPHY, SHADOWS, createThemedStyles, useTheme } from '../constants/theme';
import { AlertManager } from '../utils/alert';
import { OnboardingProgress } from '../components/OnboardingProgress';
import { Screen, Button } from '../components';

const FONT_SIZES = TYPOGRAPHY.sizes;
const { width, height } = Dimensions.get('window');
const isSmallDevice = height < 700;

interface BiometricSetupScreenProps {
  navigation: any;
  route?: any;
}

export const BiometricSetupScreen: React.FC<BiometricSetupScreenProps> = ({
  navigation,
  route,
}) => {
  useTheme();
  const rawFlowType = route?.params?.flowType;
  const flowType: 'setup' | 'restore' =
    rawFlowType === 'restore' ? 'restore' : 'setup';
  const [biometricType, setBiometricType] = useState<string>('');
  const [isAvailable, setIsAvailable] = useState(false);
  const [loading, setLoading] = useState(false);

  // Get icon and description based on biometric type
  const getBiometricIcon = () => {
    if (biometricType.includes('Face')) return 'scan-outline';
    if (biometricType.includes('Fingerprint') || biometricType.includes('Touch')) return 'finger-print-outline';
    if (biometricType.includes('Iris')) return 'eye-outline';
    return 'lock-closed-outline';
  };

  const getBiometricDescription = () => {
    if (biometricType.includes('Face')) {
      return 'Use facial recognition for quick and secure access to your wallet. Just look at your phone to unlock.';
    }
    if (biometricType.includes('Fingerprint') || biometricType.includes('Touch')) {
      return 'Use your fingerprint for quick and secure access to your wallet. Just touch the sensor to unlock.';
    }
    if (biometricType.includes('Iris')) {
      return 'Use iris scanning for quick and secure access to your wallet.';
    }
    return 'Use biometric authentication for quick and secure access to your wallet.';
  };

  const getBiometricName = () => {
    // Return the exact biometric type detected
    return biometricType || 'Biometrics';
  };

  useEffect(() => {
    checkBiometricAvailability();
  }, []);

  const checkBiometricAvailability = async () => {
    const [available, type] = await Promise.all([
      isBiometricAvailable(),
      getBiometricType(),
    ]);
    setIsAvailable(available);

    if (available) {
      setBiometricType(type);
    }
  };

  const navigateToMainTabs = () => {
    navigation.replace('MainTabs');
  };

  const syncBiometricPreference = (enabled: boolean) => {
    void (async () => {
      try {
        const walletAddress = await AsyncStorage.getItem('wallet_address');
        if (walletAddress) {
          const { error } = await supabase
            .from('users')
            .update({ biometric_enabled: enabled })
            .eq('wallet_address', walletAddress);

          if (error) {
            Logger.info('Failed to update Supabase, continuing...', error);
          }
        }
      } catch (dbError) {
        Logger.info('Failed to update Supabase, continuing...', dbError);
      }
    })();
  };

  const handleEnableBiometric = async () => {
    setLoading(true);
    try {
      const success = await enableBiometric({ skipAvailabilityCheck: isAvailable });

      if (success) {
        // Save biometric preference locally
        await AsyncStorage.setItem('biometric_enabled', 'true');

        // Cloud preference sync is optional and should not block onboarding.
        syncBiometricPreference(true);

        // Navigate directly - biometric is enabled
        navigateToMainTabs();
      } else {
        AlertManager.alert(
          'Biometric Not Enabled',
          'You can continue with your PIN and turn this on later from Profile.',
          undefined,
          { type: 'info' }
        );
        setLoading(false);
      }
    } catch (error) {
// [SECURITY] Removed sensitive log: console.error('Biometric authentication error:', error);
      setLoading(false);
    }
  };

  const handleSkip = () => {
    syncBiometricPreference(false);
    navigateToMainTabs();
  };

  return (
    <Screen padded={false} contentContainerStyle={styles.scrollContent}>
      <OnboardingProgress
        currentStep={flowType === 'restore' ? 3 : 5}
        flowType={flowType}
      />
      <View style={styles.flexFill}>
        <View style={styles.content}>
          {/* Icon */}
          <View style={styles.iconContainer}>
            <Ionicons
              name={(isAvailable ? getBiometricIcon() : 'checkmark') as any}
              size={isSmallDevice ? 40 : 48}
              color={isAvailable ? COLORS.primary : COLORS.success}
            />
          </View>

          {/* Title */}
          <Text style={styles.title}>
            {isAvailable ? `Enable ${getBiometricName()}` : 'All Set!'}
          </Text>

          {/* Description */}
          <Text style={styles.subtitle}>
            {isAvailable
              ? getBiometricDescription()
              : 'Your wallet is ready. You can use your PIN to securely access it anytime.'}
          </Text>

          {/* Feature List */}
          {isAvailable && (
            <View style={styles.featureList}>
              <View style={styles.featureItem}>
                <Ionicons name="flash-outline" size={20} color={COLORS.primary} style={styles.featureIcon} />
                <Text style={styles.featureText}>Quick unlock in seconds</Text>
              </View>
              <View style={styles.featureItem}>
                <Ionicons name="shield-checkmark-outline" size={20} color={COLORS.primary} style={styles.featureIcon} />
                <Text style={styles.featureText}>Secure & private authentication</Text>
              </View>
              <View style={styles.featureItem}>
                <Ionicons name="card-outline" size={20} color={COLORS.primary} style={styles.featureIcon} />
                <Text style={styles.featureText}>Confirm payments easily</Text>
              </View>
            </View>
          )}
        </View>

        {/* Buttons at bottom */}
        <View style={styles.buttonContainer}>
          {isAvailable && (
            <Button
              title={`Enable ${getBiometricName()}`}
              onPress={handleEnableBiometric}
              variant="primary"
              size="lg"
              fullWidth
              loading={loading}
              disabled={loading}
            />
          )}

          <Button
            title={isAvailable ? 'Use PIN Instead' : 'Get Started'}
            onPress={handleSkip}
            variant={isAvailable ? 'secondary' : 'primary'}
            size="lg"
            fullWidth
            disabled={loading}
            style={isAvailable ? styles.secondarySpacing : undefined}
          />

          {isAvailable && (
            <Text style={styles.skipNote}>
              You can enable this later in Settings
            </Text>
          )}
        </View>
      </View>
    </Screen>
  );
};

const styles = createThemedStyles((COLORS) => ({
  scrollContent: {
    flexGrow: 1,
    paddingBottom: SPACING.xl,
  },
  flexFill: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingTop: isSmallDevice ? SPACING.lg : SPACING.xl,
  },
  content: {
    alignItems: 'center',
  },
  iconContainer: {
    width: isSmallDevice ? 80 : 100,
    height: isSmallDevice ? 80 : 100,
    borderRadius: isSmallDevice ? 40 : 50,
    backgroundColor: COLORS.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: isSmallDevice ? SPACING.lg : SPACING.xl,
    ...SHADOWS.md,
  },
  icon: {
    fontSize: isSmallDevice ? 40 : 50,
  },
  title: {
    fontSize: isSmallDevice ? FONT_SIZES.xl : FONT_SIZES.xxl,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: SPACING.md,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: isSmallDevice ? FONT_SIZES.sm : FONT_SIZES.md,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginBottom: isSmallDevice ? SPACING.lg : SPACING.xl,
    paddingHorizontal: SPACING.sm,
    lineHeight: isSmallDevice ? 20 : 24,
  },
  featureList: {
    width: '100%',
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: SPACING.lg,
    marginTop: SPACING.md,
    ...SHADOWS.sm,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: isSmallDevice ? SPACING.sm : SPACING.md,
  },
  featureIcon: {
    fontSize: isSmallDevice ? 18 : 22,
    marginRight: SPACING.md,
  },
  featureText: {
    fontSize: isSmallDevice ? FONT_SIZES.sm : FONT_SIZES.md,
    color: COLORS.text,
    flex: 1,
  },
  buttonContainer: {
    width: '100%',
    marginTop: SPACING.xl,
  },
  secondarySpacing: {
    marginTop: SPACING.md,
  },
  skipNote: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: SPACING.sm,
  },
}));
