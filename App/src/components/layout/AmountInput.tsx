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
} from 'react-native';
import { COLORS, SPACING, FONT_SIZES, BORDER_RADIUS, createThemedStyles, useTheme } from '../../constants/theme';
import { MONEY_SYMBOL, MONEY_UNIT_LABEL } from '../../utils/currency';
import { A11Y } from '../../utils/strings';

export interface AmountInputProps extends Omit<TextInputProps, 'keyboardType'> {
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
  /** Currency glyph shown before the number (defaults to the app money symbol). */
  symbol?: string;
  /** Unit label shown after the number (defaults to the app unit label). */
  unitLabel?: string;
  /** Quick-pick amount chips. Hidden when `editable` is false. */
  quickAmounts?: string[];
  onQuickAmount?: (amount: string) => void;
  helper?: string;
  error?: string;
  editable?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
}

/**
 * Large numeric amount entry with currency symbol, unit label, optional
 * quick-amount chips and helper/error messaging. Shared by send / request /
 * merchant flows for a single consistent money-entry experience.
 */
export const AmountInput = forwardRef<TextInput, AmountInputProps>(
  (
    {
      label,
      value,
      onChangeText,
      symbol = MONEY_SYMBOL,
      unitLabel = MONEY_UNIT_LABEL,
      quickAmounts,
      onQuickAmount,
      helper,
      error,
      editable = true,
      containerStyle,
      style,
      ...inputProps
    },
    ref
  ) => {
  useTheme();
    const hasError = !!error;

    return (
      <View style={containerStyle}>
        {!!label && <Text style={styles.label}>{label}</Text>}
        <View
          style={[
            styles.amountWrap,
            hasError && styles.amountWrapError,
            !editable && styles.amountWrapDisabled,
          ]}
        >
          <Text style={styles.symbol} importantForAccessibility="no" accessibilityElementsHidden>
            {symbol}
          </Text>
          <TextInput
            ref={ref}
            style={[styles.input, style]}
            placeholder="0.00"
            placeholderTextColor={COLORS.textTertiary}
            value={value}
            onChangeText={onChangeText}
            keyboardType="decimal-pad"
            editable={editable}
            // Derive accessible label from the label prop so screen readers
            // announce "Amount input" rather than nothing.
            accessibilityLabel={label || A11Y.AMOUNT_INPUT}
            accessibilityHint={`Enter amount in ${unitLabel}`}
            accessibilityState={{ disabled: !editable }}
            {...inputProps}
          />
          <Text style={styles.unit} importantForAccessibility="no" accessibilityElementsHidden>
            {unitLabel}
          </Text>
        </View>

        {editable && quickAmounts && quickAmounts.length > 0 && (
          <View style={styles.quickRow}>
            {quickAmounts.map((amount) => (
              <TouchableOpacity
                key={amount}
                style={styles.quickChip}
                onPress={() => (onQuickAmount ? onQuickAmount(amount) : onChangeText(amount))}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={A11Y.QUICK_AMOUNT(`${symbol} ${amount} ${unitLabel}`)}
              >
                <Text style={styles.quickChipText} numberOfLines={1}>
                  {symbol} {amount}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {(hasError || !!helper) && (
          <Text
            style={[styles.helper, hasError && styles.errorText]}
            accessibilityRole={hasError ? 'alert' : undefined}
          >
            {hasError ? error : helper}
          </Text>
        )}
      </View>
    );
  }
);

AmountInput.displayName = 'AmountInput';

const styles = createThemedStyles((COLORS) => ({
  label: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: SPACING.sm,
  },
  amountWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
  },
  amountWrapError: {
    borderColor: COLORS.error,
  },
  amountWrapDisabled: {
    backgroundColor: COLORS.background,
  },
  symbol: {
    fontSize: FONT_SIZES.xl,
    fontWeight: '700',
    color: COLORS.text,
    marginRight: SPACING.xs,
  },
  input: {
    flex: 1,
    fontSize: FONT_SIZES.xxl,
    fontWeight: '700',
    color: COLORS.text,
    paddingVertical: SPACING.md,
  },
  unit: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: COLORS.textMuted,
    marginLeft: SPACING.sm,
  },
  quickRow: {
    flexDirection: 'row',
    marginTop: SPACING.md,
    marginHorizontal: -SPACING.xs,
  },
  quickChip: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.xs,
    marginHorizontal: SPACING.xs,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    // Minimum tap target
    minHeight: 44,
    justifyContent: 'center',
  },
  quickChipText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
    color: COLORS.primary,
  },
  helper: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    marginTop: SPACING.xs,
  },
  errorText: {
    color: COLORS.error,
  },
}));
