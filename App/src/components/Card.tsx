import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { COLORS, SPACING, BORDER_RADIUS, SHADOWS, createThemedStyles, useTheme } from '../constants/theme';

interface CardProps {
  children: React.ReactNode;
  variant?: 'default' | 'elevated' | 'outlined' | 'flat';
  padding?: keyof typeof SPACING;
  style?: ViewStyle;
  onPress?: () => void;
}

export const Card: React.FC<CardProps> = ({
  children,
  variant = 'default',
  padding = 'lg',
  style,
}) => {
  useTheme();
  const cardStyles = [
    styles.card,
    styles[`card_${variant}`],
    { padding: SPACING[padding] },
    variant === 'elevated' && SHADOWS.md,
    variant === 'default' && SHADOWS.sm,
    style,
  ];

  return <View style={cardStyles}>{children}</View>;
};

const styles = createThemedStyles((COLORS) => ({
  card: {
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.borderLight,
  },
  card_default: {
    backgroundColor: COLORS.surface,
  },
  card_elevated: {
    backgroundColor: COLORS.surface,
  },
  card_outlined: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  card_flat: {
    backgroundColor: COLORS.background,
  },
}));
