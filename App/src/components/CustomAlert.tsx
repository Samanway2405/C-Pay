import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Animated,
  Dimensions,
  Platform,
} from 'react-native';
import { COLORS, SPACING, FONT_SIZES, BORDER_RADIUS, SHADOWS, createThemedStyles, useTheme } from '../constants/theme';
import { AlertManager } from '../utils/alert';

const { width, height } = Dimensions.get('window');

interface CustomAlertButton {
  text: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
}

interface CustomAlertProps {
  visible: boolean;
  title: string;
  message?: string;
  buttons?: CustomAlertButton[];
  type?: 'success' | 'error' | 'warning' | 'info';
  onDismiss?: () => void;
}

export const CustomAlert: React.FC<CustomAlertProps> = ({
  visible,
  title,
  message,
  buttons = [{ text: 'OK', style: 'default' }],
  type = 'info',
  onDismiss,
}) => {
  useTheme();
  const [fadeAnim] = useState(new Animated.Value(0));
  const [scaleAnim] = useState(new Animated.Value(0.9));

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 8,
          tension: 40,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 0.9,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible]);

  const getIcon = () => {
    switch (type) {
      case 'success':
        return '✓';
      case 'error':
        return '✕';
      case 'warning':
        return '⚠';
      case 'info':
      default:
        return 'ⓘ';
    }
  };

  const getIconColor = () => {
    switch (type) {
      case 'success':
        return COLORS.success;
      case 'error':
        return COLORS.error;
      case 'warning':
        return COLORS.warning;
      case 'info':
      default:
        return COLORS.primary;
    }
  };

  const getIconBackground = () => {
    switch (type) {
      case 'success':
        return COLORS.successBg;
      case 'error':
        return COLORS.errorBg;
      case 'warning':
        return COLORS.warningBg;
      case 'info':
      default:
        return COLORS.infoBg;
    }
  };

  const handleButtonPress = (button: CustomAlertButton) => {
    if (button.onPress) {
      button.onPress();
    }
    if (onDismiss) {
      onDismiss();
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onDismiss}
      accessibilityViewIsModal
    >
      <Animated.View
        style={[
          styles.overlay,
          {
            opacity: fadeAnim,
          },
        ]}
      >
        <TouchableOpacity
          style={styles.overlayTouchable}
          activeOpacity={1}
          onPress={onDismiss}
        />
        <Animated.View
          style={[
            styles.alertContainer,
            {
              transform: [{ scale: scaleAnim }],
              opacity: fadeAnim,
            },
          ]}
          accessible
          accessibilityRole="alert"
          accessibilityLabel={message ? `${title}. ${message}` : title}
        >
          <View style={styles.alertContent}>
            {/* Icon */}
            <View style={[styles.iconContainer, { backgroundColor: getIconBackground() }]}>
              <Text style={[styles.icon, { color: getIconColor() }]}>
                {getIcon()}
              </Text>
            </View>

            {/* Title */}
            <Text style={styles.title}>{title}</Text>

            {/* Message */}
            {message && <Text style={styles.message}>{message}</Text>}

            {/* Buttons */}
            <View style={styles.buttonContainer}>
              {buttons.map((button, index) => {
                const isDestructive = button.style === 'destructive';
                const isCancel = button.style === 'cancel';
                const isLast = index === buttons.length - 1;

                return (
                  <TouchableOpacity
                    key={index}
                    style={[
                      styles.button,
                      isCancel && styles.cancelButton,
                      isDestructive && styles.destructiveButton,
                      !isCancel && !isDestructive && styles.defaultButton,
                      !isLast && buttons.length > 1 && styles.buttonMargin,
                      buttons.length === 1 && styles.singleButton,
                    ]}
                    onPress={() => handleButtonPress(button)}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel={button.text}
                  >
                    <Text
                      style={[
                        styles.buttonText,
                        isCancel && styles.cancelButtonText,
                      ]}
                    >
                      {button.text}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
};

const styles = createThemedStyles((COLORS) => ({
  overlay: {
    flex: 1,
    backgroundColor: COLORS.overlayLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlayTouchable: {
    position: 'absolute',
    width: '100%',
    height: '100%',
  },
  alertContainer: {
    width: width * 0.85,
    maxWidth: 400,
    borderRadius: BORDER_RADIUS.xl,
    backgroundColor: COLORS.card,
    ...SHADOWS.lg,
    overflow: 'hidden',
  },
  alertContent: {
    padding: SPACING.xl,
    alignItems: 'center',
  },
  iconContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  icon: {
    fontSize: 36,
    fontWeight: 'bold',
  },
  title: {
    fontSize: FONT_SIZES.xl,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  message: {
    fontSize: FONT_SIZES.md,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: SPACING.lg,
  },
  buttonContainer: {
    width: '100%',
    flexDirection: 'column',
    gap: SPACING.sm,
  },
  button: {
    width: '100%',
    borderRadius: BORDER_RADIUS.lg,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: COLORS.textInverse,
  },
  cancelButton: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cancelButtonText: {
    color: COLORS.text,
  },
  defaultButton: {
    backgroundColor: COLORS.primary,
  },
  destructiveButton: {
    backgroundColor: COLORS.error,
  },
  buttonMargin: {
    marginBottom: 0,
  },
  singleButton: {
    marginTop: SPACING.sm,
  },
}));

// Helper function to show alert
let alertInstance: {
  show: (config: Omit<CustomAlertProps, 'visible' | 'onDismiss'>) => void;
} | null = null;

export const showCustomAlert = (
  title: string,
  message?: string,
  buttons?: CustomAlertButton[],
  type?: 'success' | 'error' | 'warning' | 'info'
) => {
  if (alertInstance) {
    alertInstance.show({ title, message, buttons, type });
  }
};

// Alert Provider Component
export const CustomAlertProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  useTheme();
  const [alertConfig, setAlertConfig] = useState<Omit<
    CustomAlertProps,
    'visible' | 'onDismiss'
  > | null>(null);

  useEffect(() => {
    // Register with AlertManager
    AlertManager.setShowCallback((title, message, buttons, type) => {
      setAlertConfig({ title, message, buttons, type });
    });

    alertInstance = {
      show: (config) => setAlertConfig(config),
    };

    return () => {
      alertInstance = null;
    };
  }, []);

  return (
    <>
      {children}
      {alertConfig && (
        <CustomAlert
          visible={!!alertConfig}
          title={alertConfig.title}
          message={alertConfig.message}
          buttons={alertConfig.buttons}
          type={alertConfig.type}
          onDismiss={() => setAlertConfig(null)}
        />
      )}
    </>
  );
};
