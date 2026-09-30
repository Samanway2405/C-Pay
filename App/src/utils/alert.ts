import { Logger } from './logger';
/**
 * Custom Alert Utility
 * A modern, UI-based alert system to replace React Native's default Alert.alert
 */

import { Alert } from 'react-native';

interface AlertButton {
  text: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
}

type AlertType = 'success' | 'error' | 'warning' | 'info';

class AlertManager {
  private static showCallback: ((
    title: string,
    message?: string,
    buttons?: AlertButton[],
    type?: AlertType
  ) => void) | null = null;

  static setShowCallback(
    callback: (
      title: string,
      message?: string,
      buttons?: AlertButton[],
      type?: AlertType
    ) => void
  ) {
    this.showCallback = callback;
  }

  static alert(
    title: string,
    message?: string,
    buttons?: AlertButton[],
    options?: { type?: AlertType; cancelable?: boolean }
  ) {
    const type = options?.type || this.inferTypeFromTitle(title);

    if (this.showCallback) {
      // Use custom alert
      this.showCallback(title, message, buttons, type);
    } else {
      // Fallback to native alert
      Logger.warn('CustomAlert not initialized, falling back to native Alert');
      Alert.alert(title, message, buttons as any);
    }
  }

  private static inferTypeFromTitle(title: string): AlertType {
    const lowerTitle = title.toLowerCase();
    
    if (
      lowerTitle.includes('success') ||
      lowerTitle.includes('done') ||
      lowerTitle.includes('complete') ||
      lowerTitle.includes('✓') ||
      lowerTitle.includes('✅')
    ) {
      return 'success';
    }
    
    if (
      lowerTitle.includes('error') ||
      lowerTitle.includes('failed') ||
      lowerTitle.includes('fail') ||
      lowerTitle.includes('invalid') ||
      lowerTitle.includes('denied') ||
      lowerTitle.includes('❌') ||
      lowerTitle.includes('✕')
    ) {
      return 'error';
    }
    
    if (
      lowerTitle.includes('warning') ||
      lowerTitle.includes('caution') ||
      lowerTitle.includes('attention') ||
      lowerTitle.includes('⚠')
    ) {
      return 'warning';
    }
    
    return 'info';
  }
}

export { AlertManager };
