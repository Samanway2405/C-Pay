import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { COLORS, SPACING, FONT_SIZES, createThemedStyles, useTheme } from '../../constants/theme';

export interface SectionProps {
  title?: string;
  subtitle?: string;
  /** Optional trailing action shown in the section header (e.g. "See all"). */
  actionLabel?: string;
  onActionPress?: () => void;
  children: React.ReactNode;
  /** Vertical spacing below the section (default md). */
  spacing?: keyof typeof SPACING;
  style?: StyleProp<ViewStyle>;
  headerStyle?: StyleProp<ViewStyle>;
}

/**
 * A titled content group with a consistent header row and spacing. Keeps every
 * screen's "label + content block" rhythm identical.
 */
export const Section: React.FC<SectionProps> = ({
  title,
  subtitle,
  actionLabel,
  onActionPress,
  children,
  spacing = 'xl',
  style,
  headerStyle,
}) => {
  useTheme();
  const hasHeader = !!title || !!actionLabel;

  return (
    <View style={[{ marginBottom: SPACING[spacing] }, style]}>
      {hasHeader && (
        <View style={[styles.header, headerStyle]}>
          <View style={styles.titleWrap}>
            {!!title && <Text style={styles.title}>{title}</Text>}
            {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
          </View>
          {!!actionLabel && !!onActionPress && (
            <TouchableOpacity
              onPress={onActionPress}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={
                title ? `${actionLabel}, ${title} section` : actionLabel
              }
              style={styles.actionTouch}
            >
              <Text style={styles.action}>{actionLabel}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      {children}
    </View>
  );
};

const styles = createThemedStyles((COLORS) => ({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
  },
  titleWrap: {
    flex: 1,
    paddingRight: SPACING.sm,
  },
  title: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '700',
    color: COLORS.text,
  },
  subtitle: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  action: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: COLORS.primary,
  },
  // Ensure minimum 44pt tap area on the trailing action button.
  actionTouch: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: SPACING.xs,
  },
}));
