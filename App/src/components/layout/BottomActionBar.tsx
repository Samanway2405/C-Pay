import React from 'react';
import { View, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, SPACING, createThemedStyles, useTheme } from '../../constants/theme';

export interface BottomActionBarProps {
  children: React.ReactNode;
  /** Add a top divider/elevation to separate from scrolling content (default true). */
  bordered?: boolean;
  /** Lay buttons out side by side instead of stacked. */
  row?: boolean;
  backgroundColor?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Sticky bottom container for a screen's primary CTA(s). Owns the bottom
 * safe-area inset so buttons never sit under the home indicator / nav bar.
 */
export const BottomActionBar: React.FC<BottomActionBarProps> = ({
  children,
  bordered = true,
  row = false,
  backgroundColor = COLORS.surface,
  style,
}) => {
  useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.container,
        bordered && styles.bordered,
        { backgroundColor, paddingBottom: Math.max(insets.bottom, SPACING.md) },
        row && styles.row,
        style,
      ]}
    >
      {children}
    </View>
  );
};

const styles = createThemedStyles((COLORS) => ({
  container: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
  },
  bordered: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
}));
