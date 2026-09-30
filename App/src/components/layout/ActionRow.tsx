import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, FONT_SIZES, BORDER_RADIUS, createThemedStyles, useTheme } from '../../constants/theme';

export interface ActionRowProps {
  /** Leading icon, shown in a tinted circular badge. */
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  iconBackground?: string;
  title: string;
  subtitle?: string;
  /** Trailing value text (e.g. a setting's current value). */
  value?: string;
  onPress?: () => void;
  /** Show a chevron on the right (default true when onPress is set). */
  showChevron?: boolean;
  /** Custom trailing node (e.g. a Switch). Overrides value/chevron. */
  right?: React.ReactNode;
  /** Render in a destructive style. */
  destructive?: boolean;
  disabled?: boolean;
  /** Accessible label. Defaults to the title (+ value if present). */
  accessibilityLabel?: string;
  /** Accessible hint describing what happens on press. */
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Tappable settings / navigation row: leading icon badge, title + subtitle,
 * and a trailing value, chevron or custom control. Used across Profile,
 * merchant dashboards and menus.
 */
export const ActionRow: React.FC<ActionRowProps> = ({
  icon,
  iconColor,
  iconBackground,
  title,
  subtitle,
  value,
  onPress,
  showChevron,
  right,
  destructive = false,
  disabled = false,
  accessibilityLabel,
  accessibilityHint,
  style,
}) => {
  useTheme();
  const chevron = showChevron ?? !!onPress;
  const tint = destructive ? COLORS.error : iconColor || COLORS.primary;
  const badgeBg = destructive ? COLORS.errorBg : iconBackground || COLORS.primaryLight;

  // Default accessible label: title + current value (if text, not a custom node)
  const defaultLabel = value ? `${title}, ${value}` : title;

  const Container: any = onPress ? TouchableOpacity : View;

  return (
    <Container
      style={[styles.row, disabled && styles.disabled, style]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={onPress ? (accessibilityLabel || defaultLabel) : undefined}
      accessibilityHint={accessibilityHint}
      accessibilityState={onPress ? { disabled } : undefined}
    >
      {!!icon && (
        <View
          style={[styles.iconBadge, { backgroundColor: badgeBg }]}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          <Ionicons name={icon} size={20} color={tint} />
        </View>
      )}
      <View style={styles.textWrap}>
        <Text
          style={[styles.title, destructive && styles.titleDestructive]}
          numberOfLines={1}
          // Title is covered by the container's accessibilityLabel on tappable rows
          importantForAccessibility={onPress ? 'no-hide-descendants' : 'yes'}
        >
          {title}
        </Text>
        {!!subtitle && (
          <Text
            style={styles.subtitle}
            numberOfLines={2}
            importantForAccessibility={onPress ? 'no-hide-descendants' : 'yes'}
          >
            {subtitle}
          </Text>
        )}
      </View>
      {right ? (
        right
      ) : (
        <View
          style={styles.trailing}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          {!!value && (
            <Text style={styles.value} numberOfLines={1}>
              {value}
            </Text>
          )}
          {chevron && (
            <Ionicons
              name="chevron-forward"
              size={18}
              color={COLORS.textTertiary}
              style={value ? styles.chevronSpacing : undefined}
            />
          )}
        </View>
      )}
    </Container>
  );
};

const styles = createThemedStyles((COLORS) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
    minHeight: 60,
  },
  disabled: {
    opacity: 0.5,
  },
  iconBadge: {
    width: 40,
    height: 40,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.md,
  },
  textWrap: {
    flex: 1,
    paddingRight: SPACING.sm,
  },
  title: {
    fontSize: FONT_SIZES.base,
    fontWeight: '600',
    color: COLORS.text,
  },
  titleDestructive: {
    color: COLORS.error,
  },
  subtitle: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: '40%',
  },
  value: {
    fontSize: FONT_SIZES.md,
    color: COLORS.textMuted,
  },
  chevronSpacing: {
    marginLeft: SPACING.xs,
  },
}));
