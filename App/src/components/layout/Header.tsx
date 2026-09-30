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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, SPACING, FONT_SIZES, SHADOWS, createThemedStyles, useTheme } from '../../constants/theme';

export interface HeaderAction {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  accessibilityLabel: string;
  /** Optional badge dot (e.g. notifications). */
  badge?: boolean;
  color?: string;
}

export interface HeaderProps {
  title?: string;
  subtitle?: string;
  /** Show a circular back button on the left. */
  onBack?: () => void;
  /** Custom node on the left (overrides the back button). */
  left?: React.ReactNode;
  /** Up to two trailing actions, or a custom node. */
  actions?: HeaderAction[];
  right?: React.ReactNode;
  /** Center the title (default false = left aligned). */
  centerTitle?: boolean;
  /** Apply the top safe-area inset (default true). Set false when a native nav header is present. */
  applyTopInset?: boolean;
  backgroundColor?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Consistent screen header: optional back button, title/subtitle with
 * truncation, and trailing actions. Handles its own top safe-area inset so it
 * can sit flush at the top of a <Screen />.
 */
export const Header: React.FC<HeaderProps> = ({
  title,
  subtitle,
  onBack,
  left,
  actions,
  right,
  centerTitle = false,
  applyTopInset = true,
  backgroundColor = 'transparent',
  style,
}) => {
  useTheme();
  const insets = useSafeAreaInsets();
  const paddingTop = (applyTopInset ? insets.top : 0) + SPACING.sm;

  const renderLeft = () => {
    if (left) return left;
    if (onBack) {
      return (
        <TouchableOpacity
          style={styles.iconButton}
          onPress={onBack}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="arrow-back" size={22} color={COLORS.text} />
        </TouchableOpacity>
      );
    }
    return <View style={styles.sidePlaceholder} />;
  };

  const renderRight = () => {
    if (right) return right;
    if (actions && actions.length > 0) {
      return (
        <View style={styles.actionsRow}>
          {actions.map((action, index) => (
            <TouchableOpacity
              key={`${action.icon}-${index}`}
              style={[styles.iconButton, index > 0 && styles.actionSpacing]}
              onPress={action.onPress}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={action.accessibilityLabel}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name={action.icon} size={20} color={action.color || COLORS.text} />
              {action.badge && <View style={styles.badge} />}
            </TouchableOpacity>
          ))}
        </View>
      );
    }
    return <View style={styles.sidePlaceholder} />;
  };

  return (
    <View style={[styles.container, { paddingTop, backgroundColor }, style]}>
      {renderLeft()}
      <View style={[styles.titleWrap, centerTitle ? styles.titleCenter : styles.titleLeft]}>
        {!!title && (
          <Text
            style={[styles.title, centerTitle && styles.titleTextCenter]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {title}
          </Text>
        )}
        {!!subtitle && (
          <Text
            style={[styles.subtitle, centerTitle && styles.titleTextCenter]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {subtitle}
          </Text>
        )}
      </View>
      {renderRight()}
    </View>
  );
};

const styles = createThemedStyles((COLORS) => ({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.sm,
    minHeight: 52,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOWS.sm,
  },
  sidePlaceholder: {
    width: 40,
    height: 40,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionSpacing: {
    marginLeft: SPACING.sm,
  },
  titleWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  titleLeft: {
    paddingHorizontal: SPACING.md,
    alignItems: 'flex-start',
  },
  titleCenter: {
    paddingHorizontal: SPACING.sm,
    alignItems: 'center',
  },
  title: {
    fontSize: FONT_SIZES.xl,
    fontWeight: '700',
    color: COLORS.text,
  },
  titleTextCenter: {
    textAlign: 'center',
  },
  subtitle: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  badge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.error,
  },
}));
