import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { generatePaymentQR } from '../utils/qrCode';
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS, SHADOWS, createThemedStyles, useTheme } from '../constants/theme';
import { MONEY_UNIT_LABEL } from '../utils/currency';
import { Screen, FormField, Button } from '../components';

const FONT_SIZES = TYPOGRAPHY.sizes;

interface QRGeneratorScreenProps {
  navigation: any;
}

export const QRGeneratorScreen: React.FC<QRGeneratorScreenProps> = ({ navigation }) => {
  useTheme();
  const [merchantName, setMerchantName] = useState('Tea Stall');
  const [amount, setAmount] = useState('10.00');
  const [merchantAddress, setMerchantAddress] = useState('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF');
  const [note, setNote] = useState('');
  const [qrData, setQrData] = useState('');

  const handleGenerateQR = () => {
    const data = generatePaymentQR(merchantAddress, amount, merchantName, note || undefined);
    setQrData(data);
  };

  // Generate QR on mount with default values
  React.useEffect(() => {
    handleGenerateQR();
  }, []);

  return (
    <Screen topInset={false}>
      <View style={styles.header}>
        <Text style={styles.title}>QR Code Generator</Text>
        <Text style={styles.subtitle}>Create a Stellar testnet payment request</Text>
      </View>

      {/* Input Fields */}
      <View style={styles.form}>
        <FormField
          containerStyle={styles.inputGroup}
          label="Merchant Name"
          value={merchantName}
          onChangeText={setMerchantName}
          placeholder="Enter merchant name"
        />

        <FormField
          containerStyle={styles.inputGroup}
          label={`Amount (${MONEY_UNIT_LABEL})`}
          value={amount}
          onChangeText={setAmount}
          placeholder="Enter amount"
          keyboardType="decimal-pad"
        />

        <FormField
          containerStyle={styles.inputGroup}
          label="Merchant Address"
          value={merchantAddress}
          onChangeText={setMerchantAddress}
          placeholder="Enter Stellar account"
          monospace
        />

        <FormField
          containerStyle={styles.inputGroup}
          label="Note (Optional)"
          value={note}
          onChangeText={setNote}
          placeholder="Enter note"
        />

        <Button
          title="Generate QR Code"
          onPress={handleGenerateQR}
          variant="primary"
          size="lg"
          fullWidth
          style={styles.generateButton}
        />
      </View>

      {/* QR Code Display */}
      {qrData && (
        <View style={styles.qrContainer}>
          <View style={styles.qrCard}>
            <QRCode value={qrData} size={250} />
          </View>
          <View style={styles.instructionRow}>
            <Ionicons name="scan-outline" size={18} color={COLORS.textMuted} />
            <Text style={styles.instruction}>Use Scan to Pay on Home screen to test</Text>
          </View>
        </View>
      )}
    </Screen>
  );
};

const styles = createThemedStyles((COLORS) => ({
  header: {
    alignItems: 'center',
    marginBottom: SPACING.xl,
    marginTop: SPACING.lg,
  },
  title: {
    fontSize: FONT_SIZES.xxl,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: SPACING.xs,
  },
  subtitle: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
  },
  form: {
    marginBottom: SPACING.xl,
  },
  inputGroup: {
    marginBottom: SPACING.md,
  },
  generateButton: {
    marginTop: SPACING.md,
  },
  qrContainer: {
    alignItems: 'center',
  },
  qrCard: {
    backgroundColor: COLORS.card,
    padding: SPACING.xl,
    borderRadius: BORDER_RADIUS.lg,
    ...SHADOWS.md,
    marginBottom: SPACING.lg,
  },
  instruction: {
    fontSize: FONT_SIZES.md,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
  instructionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
  },
}));
