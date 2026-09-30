import { Logger } from './logger';
import { Alert } from 'react-native';
import { authenticateWithBiometric, authenticateWithPIN } from '../utils/biometric';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { formatMoneyAmount } from './currency';

/**
 * Confirm payment with biometric or PIN
 * This function shows how to authenticate for payments without exposing seed phrase
 */
export async function confirmPayment(amount: string, recipient: string): Promise<boolean> {
  try {
    // Check if biometric is enabled
    const biometricEnabled = await AsyncStorage.getItem('biometric_enabled');

    if (biometricEnabled === 'true') {
      // Try biometric first
      const success = await authenticateWithBiometric();
      
      if (!success) {
        // User cancelled or biometric failed
        return false;
      }
      
      return true; // Payment authorized via biometric
    } else {
      Alert.alert(
        'Confirm Payment',
        `Send ${formatMoneyAmount(parseFloat(amount))} to ${recipient}?`
      );

      return authenticateWithPIN();
    }
  } catch (error) {
    Logger.error('Payment confirmation error:', error);
    return false;
  }
}

/**
 * Example usage in a payment screen:
 * 
 * const handleSendPayment = async () => {
 *   const authorized = await confirmPayment('100', 'GABC...WXYZ');
 *   
 *   if (authorized) {
 *     // Proceed with transaction
 *     // Note: Wallet is loaded with PIN internally, never exposed
 *   } else {
 *     Alert.alert('Payment Cancelled');
 *   }
 * };
 */
