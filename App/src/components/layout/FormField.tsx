import React, { forwardRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TextInputProps,
  TouchableOpacity,
  StyleSheet,
  StyleProp,
  ViewStyle,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, FONT_SIZES, BORDER_RADIUS, createThemedStyles, useTheme } from '../../constants/theme';

export interface FormFieldAction {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  accessibilityLabel: string;
}

export interface FormFieldProps extends TextInputProps {
  label?: string;
  /** Helper text shown below the input when there is no error. */
  helper?: string;
  /** Error message; when set the field renders in its error state. */
  error?: string;
  /** Leading icon inside the input. */
  leftIcon?: keyof typeof Ionicons.glyphMap;
  /** Trailing tappable action inside the input (e.g. paste, clear). */
  rightAction?: FormFieldAction;
  /** Render the input as a multiline textarea. */
  multiline?: boolean;
  /** Use a monospace font (for addresses / IDs). */
  monospace?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
}

/**
 * Labeled text input with consistent borders, focus/error states, optional
 * leading icon, trailing action, and helper/error messaging. Forwards a ref to
 * the underlying TextInput.
 */
export const FormField = forwardRef<TextInput, FormFieldProps>(
  (
    {
      label,
      helper,
      error,
      leftIcon,
      rightAction,
      multiline = false,
      monospace = false,
      containerStyle,
      style,
      onFocus,
      onBlur,
      accessibilityLabel,
      placeholder,
      ...inputProps
    },
    ref
  ) => {
  useTheme();
    const [focused, setFocused] = React.useState(false);
    const hasError = !!error;

    // Derive accessible label: prefer explicit prop, then label, then placeholder.
    const derivedAccessibilityLabel = accessibilityLabel || label || placeholder;

    return (
      <View style={containerStyle}>
        {!!label && <Text style={styles.label}>{label}</Text>}
        <View
          style={[
            styles.inputWrap,
            multiline && styles.inputWrapMultiline,
            focused && styles.inputWrapFocused,
            hasError && styles.inputWrapError,
          ]}
        >
          {!!leftIcon && (
            <Ionicons
              name={leftIcon}
              size={20}
              color={hasError ? COLORS.error : COLORS.textTertiary}
              style={styles.leftIcon}
              // Decorative — label covers purpose
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
          )}
          <TextInput
            ref={ref}
            style={[
              styles.input,
              multiline && styles.inputMultiline,
              monospace && styles.inputMono,
              style,
            ]}
            placeholder={placeholder}
            placeholderTextColor={COLORS.textTertiary}
            multiline={multiline}
            onFocus={(e) => {
              setFocused(true);
              onFocus?.(e);
            }}
            onBlur={(e) => {
              setFocused(false);
              onBlur?.(e);
            }}
            accessibilityLabel={derivedAccessibilityLabel}
            accessibilityState={{ disabled: inputProps.editable === false }}
            {...inputProps}
          />
          {!!rightAction && (
            <TouchableOpacity
              style={styles.rightAction}
              onPress={rightAction.onPress}
              accessibilityRole="button"
              accessibilityLabel={rightAction.accessibilityLabel}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name={rightAction.icon} size={20} color={COLORS.primary} />
            </TouchableOpacity>
          )}
        </View>
        {(hasError || !!helper) && (
          <Text
            style={[styles.helper, hasError && styles.error]}
            // Announce errors as an alert so screen readers read them immediately.
            accessibilityRole={hasError ? 'alert' : undefined}
            accessibilityLiveRegion={hasError ? 'polite' : undefined}
          >
            {hasError ? error : helper}
          </Text>
        )}
      </View>
    );
  }
);

FormField.displayName = 'FormField';

const styles = createThemedStyles((COLORS) => ({
  label: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: SPACING.sm,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    minHeight: 52,
  },
  inputWrapMultiline: {
    alignItems: 'flex-start',
  },
  inputWrapFocused: {
    borderColor: COLORS.primary,
  },
  inputWrapError: {
    borderColor: COLORS.error,
  },
  leftIcon: {
    marginRight: SPACING.sm,
  },
  input: {
    flex: 1,
    fontSize: FONT_SIZES.base,
    color: COLORS.text,
    paddingVertical: SPACING.md,
  },
  inputMultiline: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  inputMono: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  rightAction: {
    paddingLeft: SPACING.sm,
    paddingVertical: SPACING.sm,
    // Ensure the icon button meets 44pt tap target height
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  helper: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    marginTop: SPACING.xs,
  },
  error: {
    color: COLORS.error,
  },
}));
