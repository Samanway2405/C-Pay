import React from 'react';
import {
  Modal,
  View,
  Text,
  ActivityIndicator,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, SPACING, FONT_SIZES, BORDER_RADIUS, createThemedStyles, useTheme } from '../../constants/theme';
import { Button } from '../Button';

export type StatusSheetVariant = 'loading' | 'success' | 'error' | 'warning' | 'info';

export interface StatusSheetAction {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
}

export interface StatusSheetProps {
  visible: boolean;
  variant: StatusSheetVariant;
  title: string;
  message?: string;
  /** Primary and (optional) secondary actions, stacked. Hidden for `loading`. */
  actions?: StatusSheetAction[];
  /** Called on backdrop press / hardware back. Omit to make the sheet non-dismissable. */
  onRequestClose?: () => void;
}

const getVariants = (): Record<
  Exclude<StatusSheetVariant, 'loading'>,
  { icon: keyof typeof Ionicons.glyphMap; fg: string; bg: string }
> => ({
  success: { icon: 'checkmark-circle', fg: COLORS.success, bg: COLORS.successBg },
  error: { icon: 'close-circle', fg: COLORS.error, bg: COLORS.errorBg },
  warning: { icon: 'warning', fg: COLORS.warning, bg: COLORS.warningBg },
  info: { icon: 'information-circle', fg: COLORS.info, bg: COLORS.infoBg },
});

/**
 * Bottom sheet for terminal/transient states: loading, success, error,
 * confirmation. Centralizes the icon + title + message + actions layout so
 * success/failure/processing states look identical everywhere.
 */
export const StatusSheet: React.FC<StatusSheetProps> = ({
  visible,
  variant,
  title,
  message,
  actions,
  onRequestClose,
}) => {
  useTheme();
  const insets = useSafeAreaInsets();
  const variants = getVariants();
  const dismissable = !!onRequestClose;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onRequestClose}
      // Mark as a modal so iOS VoiceOver traps focus inside it and Android
      // TalkBack treats it as a dialog window.
      accessibilityViewIsModal
    >
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={dismissable ? onRequestClose : undefined}
        // When the sheet is non-dismissable, tell screen readers the backdrop
        // is not interactive so they don't try to activate it.
        accessibilityElementsHidden={!dismissable}
        importantForAccessibility={dismissable ? 'yes' : 'no'}
        accessible={dismissable}
        accessibilityRole={dismissable ? 'button' : undefined}
        accessibilityLabel={dismissable ? 'Dismiss' : undefined}
      >
        <TouchableOpacity
          activeOpacity={1}
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, SPACING.lg) }]}
          // Prevent backdrop press from closing when tapping the sheet itself.
          onPress={() => {}}
          accessible={false}
        >
          {/* Grabber is decorative */}
          <View
            style={styles.grabber}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />

          {variant === 'loading' ? (
            <View
              style={[styles.iconBadge, { backgroundColor: COLORS.primaryLight }]}
              accessibilityElementsHidden
              importantForAccessibility="no"
            >
              <ActivityIndicator size="large" color={COLORS.primary} />
            </View>
          ) : (
            <View
              style={[styles.iconBadge, { backgroundColor: variants[variant].bg }]}
              accessibilityElementsHidden
              importantForAccessibility="no"
            >
              <Ionicons name={variants[variant].icon} size={40} color={variants[variant].fg} />
            </View>
          )}

          <Text
            style={styles.title}
            // The title is the first thing screen readers should announce when
            // the sheet appears.
            accessibilityRole="header"
          >
            {title}
          </Text>
          {!!message && (
            <Text
              style={styles.message}
              accessibilityLiveRegion="polite"
            >
              {message}
            </Text>
          )}

          {variant !== 'loading' && actions && actions.length > 0 && (
            <View style={styles.actions}>
              {actions.map((action, index) => (
                <Button
                  key={`${action.label}-${index}`}
                  title={action.label}
                  onPress={action.onPress}
                  variant={action.variant || (index === 0 ? 'primary' : 'secondary')}
                  fullWidth
                  style={index > 0 ? styles.actionSpacing : undefined}
                />
              ))}
            </View>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};

const styles = createThemedStyles((COLORS) => ({
  backdrop: {
    flex: 1,
    backgroundColor: COLORS.overlay,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: BORDER_RADIUS.xxl,
    borderTopRightRadius: BORDER_RADIUS.xxl,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    alignItems: 'center',
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    marginBottom: SPACING.lg,
  },
  iconBadge: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.lg,
  },
  title: {
    fontSize: FONT_SIZES.xl,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
  },
  message: {
    fontSize: FONT_SIZES.md,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: SPACING.sm,
    lineHeight: 22,
  },
  actions: {
    width: '100%',
    marginTop: SPACING.xl,
  },
  actionSpacing: {
    marginTop: SPACING.sm,
  },
}));
