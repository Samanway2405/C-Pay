import React, { useEffect, useRef } from 'react';

// Payment processing screen: keeps users informed while the transfer settles.
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, FONT_SIZES, BORDER_RADIUS } from '../constants/theme';

const { width } = Dimensions.get('window');

interface PaymentProcessingScreenProps {
  navigation: any;
  route: {
    params: {
      amount: string;
      recipientName: string;
      recipientAddress: string;
    };
  };
}

export const PaymentProcessingScreen: React.FC<PaymentProcessingScreenProps> = ({
  navigation,
  route,
}) => {
  const { amount, recipientName, recipientAddress } = route.params;
  const [subtitle, setSubtitle] = React.useState('This may take a few seconds');
  
  // Animations
  const spinValue = useRef(new Animated.Value(0)).current;
  const pulseValue = useRef(new Animated.Value(1)).current;
  const fadeValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Fade in animation
    Animated.timing(fadeValue, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();

    // Pulsing animation for dots
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseValue, {
          toValue: 1.3,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseValue, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[COLORS.primary, COLORS.secondary]}
        style={styles.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View style={styles.content}>
        <Animated.View style={{ opacity: fadeValue, flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          {/* Processing Icon */}
          <View style={styles.processingIconCircle}>
            <View style={styles.dotsContainer}>
              <Animated.View style={[styles.dot, { transform: [{ scale: pulseValue }] }]} />
              <Animated.View style={[styles.dot, { transform: [{ scale: pulseValue }], opacity: 0.7 }]} />
              <Animated.View style={[styles.dot, { transform: [{ scale: pulseValue }], opacity: 0.5 }]} />
            </View>
          </View>

          {/* Title */}
          <Text style={styles.processingTitle}>Processing Payment</Text>
          <Text style={styles.processingSubtitle}>{subtitle}</Text>
          
          {/* Warning Message */}
          <View style={styles.warningBox}>
            <Ionicons name="alert-circle-outline" size={20} color={COLORS.textInverse} style={styles.warningIcon} />
            <Text style={styles.warningText}>Please do not press back button</Text>
          </View>
          </Animated.View>
        </View>
      </LinearGradient>
    </View>
  );
};

const styles = createThemedStyles((COLORS) => ({
  container: {
    flex: 1,
  },
  gradient: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.xxxl + 20,
    paddingBottom: SPACING.xl,
    justifyContent: 'space-between',
  },
  processingIconCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: COLORS.whiteOverlay,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.xxl,
  },
  dotsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.textInverse,
  },
  processingTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.textInverse,
    marginBottom: SPACING.sm,
    textAlign: 'center',
  },
  processingSubtitle: {
    fontSize: FONT_SIZES.md,
    color: COLORS.textOnBrandMuted,
    fontWeight: '500',
    textAlign: 'center',
    marginBottom: SPACING.xxl,
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.whiteOverlaySubtle,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.xl,
    borderWidth: 1,
    borderColor: COLORS.whiteOverlayMedium,
    gap: SPACING.sm,
  },
  warningIcon: {
    marginRight: SPACING.xs,
  },
  warningText: {
    fontSize: FONT_SIZES.md,
    color: COLORS.textInverse,
    fontWeight: '600',
  },
}));
