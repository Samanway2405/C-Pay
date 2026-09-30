import React from 'react';
import {
  View,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  StyleProp,
  ViewStyle,
  RefreshControlProps,
  ActivityIndicator,
  Text,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, SPACING, FONT_SIZES, createThemedStyles, useTheme } from '../../constants/theme';
import { useResponsive } from '../../hooks/useResponsive';

export interface ScreenProps {
  children: React.ReactNode;
  /** Render children inside a ScrollView (default true). Set false for fixed layouts. */
  scroll?: boolean;
  /** A <Header /> (or any node) pinned above the scrollable content. */
  header?: React.ReactNode;
  /** A sticky footer (e.g. <BottomActionBar />) pinned to the bottom. */
  footer?: React.ReactNode;
  /** Show a centered spinner instead of children. */
  loading?: boolean;
  loadingText?: string;
  /** Wrap content in a KeyboardAvoidingView (default true). */
  keyboardAvoiding?: boolean;
  /** Apply the responsive horizontal gutter to the content (default true). */
  padded?: boolean;
  /**
   * Apply the top safe-area inset to the content when there is no `header`.
   * Set false on screens rendered under a native navigation header (which
   * already accounts for the inset). Default true.
   */
  topInset?: boolean;
  backgroundColor?: string;
  contentContainerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  testID?: string;
}

/**
 * App-wide screen shell. Centralizes safe-area handling, background, scrolling,
 * keyboard avoidance, responsive gutters and a consistent loading state so
 * individual screens stop re-implementing these by hand.
 *
 * Safe-area contract: when a `header` is supplied it owns the top inset and when
 * a `footer` is supplied it owns the bottom inset, so the scroll content never
 * double-pads.
 */
export const Screen: React.FC<ScreenProps> = ({
  children,
  scroll = true,
  header,
  footer,
  loading = false,
  loadingText,
  keyboardAvoiding = true,
  padded = true,
  topInset = true,
  backgroundColor = COLORS.background,
  contentContainerStyle,
  style,
  refreshControl,
  testID,
}) => {
  useTheme();
  const insets = useSafeAreaInsets();
  const { gutter, maxContentWidth, isTablet } = useResponsive();

  const horizontalPadding = padded ? gutter : 0;
  const contentTopPadding = header
    ? SPACING.lg
    : (topInset ? insets.top : 0) + SPACING.md;
  const contentBottomPadding = (footer ? SPACING.lg : insets.bottom + SPACING.lg);

  const innerWidthStyle: ViewStyle = isTablet
    ? { width: '100%', maxWidth: maxContentWidth, alignSelf: 'center' }
    : {};

  let body: React.ReactNode;

  if (loading) {
    body = (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        {!!loadingText && <Text style={styles.loadingText}>{loadingText}</Text>}
      </View>
    );
  } else if (scroll) {
    body = (
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[
          {
            paddingHorizontal: horizontalPadding,
            paddingTop: contentTopPadding,
            paddingBottom: contentBottomPadding,
          },
          innerWidthStyle,
          contentContainerStyle,
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={refreshControl}
      >
        {children}
      </ScrollView>
    );
  } else {
    body = (
      <View
        style={[
          styles.flex,
          {
            paddingHorizontal: horizontalPadding,
            paddingTop: contentTopPadding,
            paddingBottom: contentBottomPadding,
          },
          innerWidthStyle,
          contentContainerStyle,
        ]}
      >
        {children}
      </View>
    );
  }

  const inner = (
    <View style={styles.flex}>
      {header}
      {body}
      {footer}
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor }, style]} testID={testID}>
      {keyboardAvoiding ? (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {inner}
        </KeyboardAvoidingView>
      ) : (
        inner
      )}
    </View>
  );
};

const styles = createThemedStyles((COLORS) => ({
  root: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.xl,
  },
  loadingText: {
    marginTop: SPACING.md,
    fontSize: FONT_SIZES.md,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
}));
