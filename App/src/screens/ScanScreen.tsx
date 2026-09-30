import { Logger } from '../utils/logger';
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
  ActivityIndicator,
} from 'react-native';
import { Camera, CameraView } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../services/supabase';
import {
  parseAnyPaymentQR,
  validatePaymentQR,
  validatePaymentQRV3,
  verifyQRPayloadWithRelayer,
  PaymentQRData,
  PaymentQRDataV3,
  QRVerificationStatus,
} from '../utils/qrCode';
import { isValidAccountId } from '../services/blockchain';
import { COLORS, SPACING, FONT_SIZES, BORDER_RADIUS, createThemedStyles, useTheme } from '../constants/theme';
import { AlertManager } from '../utils/alert';

interface ScanScreenProps {
  navigation: any;
  route: any;
}

// ---------------------------------------------------------------------------
// Verification badge component
// ---------------------------------------------------------------------------

interface VerificationBadgeProps {
  status: QRVerificationStatus | null;
  reason?: string;
}

const VerificationBadge: React.FC<VerificationBadgeProps> = ({ status, reason }) => {
  if (status === null) return null;

  const configs: Record<QRVerificationStatus, { icon: string; label: string; bg: string; text: string }> = {
    verified: {
      icon: 'shield-checkmark',
      label: 'Verified merchant',
      bg: COLORS.successOverlay,   // success green
      text: COLORS.textInverse,
    },
    unverified: {
      icon: 'shield-outline',
      label: 'Unverified (legacy QR)',
      bg: COLORS.warningOverlay,   // warning amber
      text: COLORS.textInverse,
    },
    expired: {
      icon: 'time-outline',
      label: 'QR code expired',
      bg: COLORS.errorOverlay,   // error red
      text: COLORS.textInverse,
    },
    invalid: {
      icon: 'close-circle',
      label: reason || 'Invalid QR',
      bg: COLORS.errorOverlay,
      text: COLORS.textInverse,
    },
  };

  const { icon, label, bg, text } = configs[status];

  return (
    <View style={[styles.verificationBadge, { backgroundColor: bg }]}>
      <Ionicons name={icon as any} size={16} color={text} />
      <Text style={[styles.verificationBadgeText, { color: text }]}>{label}</Text>
    </View>
  );
};

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export const ScanScreen: React.FC<ScanScreenProps> = ({ navigation, route }) => {
  useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanned, setScanned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState<QRVerificationStatus | null>(null);
  const [verificationReason, setVerificationReason] = useState<string | undefined>(undefined);
  const scannerSize = Math.min(width * 0.7, height * 0.42, 320);
  const headerTopPadding = Math.max(insets.top + SPACING.md, SPACING.xl);
  const footerBottomPadding = Math.max(insets.bottom + SPACING.md, SPACING.xl);

  useEffect(() => {
    checkCameraPermission();
  }, []);

  const checkCameraPermission = async () => {
    const { status: existingStatus } = await Camera.getCameraPermissionsAsync();
    if (existingStatus === 'granted') {
      setHasPermission(true);
      return;
    }
    const { status } = await Camera.requestCameraPermissionsAsync();
    setHasPermission(status === 'granted');
  };

  // Get the current Supabase session token for relayer verification calls.
  const getBearerToken = async (): Promise<string | undefined> => {
    try {
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token;
    } catch {
      return undefined;
    }
  };

  const resetScan = () => {
    setScanned(false);
    setLoading(false);
    setVerifying(false);
    setVerificationStatus(null);
    setVerificationReason(undefined);
  };

  const handleBarCodeScanned = async ({ type, data }: { type: string; data: string }) => {
    setScanned(true);
    setLoading(true);

    try {
      // -----------------------------------------------------------------------
      // 1. Bare Stellar address (no JSON)
      // -----------------------------------------------------------------------
      if (isValidAccountId(data.trim())) {
        setLoading(false);
        navigation.replace('SendMoney', {
          recipientAddress: data.trim(),
          recipientName: undefined,
          isMerchantPayment: false,
          isFromQR: true,
          hideBalance: route?.params?.returnTo !== 'SendMoney',
        });
        return;
      }

      // -----------------------------------------------------------------------
      // 2. Parse JSON – accepts v2 and v3
      // -----------------------------------------------------------------------
      const parsed = parseAnyPaymentQR(data);

      if (!parsed) {
        AlertManager.alert(
          'Invalid QR Code',
          'Please scan a valid Stellar account QR code or C-Pay payment request.',
          [{ text: 'Scan Again', onPress: resetScan }]
        );
        return;
      }

      // -----------------------------------------------------------------------
      // 3. Version-specific structural validation
      // -----------------------------------------------------------------------
      if (parsed.version === 3) {
        const v3 = parsed as PaymentQRDataV3;
        const structCheck = validatePaymentQRV3(v3);
        if (!structCheck.valid) {
          AlertManager.alert('Invalid Payment', structCheck.error || 'Invalid QR data', [
            { text: 'Scan Again', onPress: resetScan },
          ]);
          return;
        }

        // -----------------------------------------------------------------------
        // 4. Relayer signature verification for v3
        // -----------------------------------------------------------------------
        setLoading(false);
        setVerifying(true);

        const token = await getBearerToken();
        const verificationResult = await verifyQRPayloadWithRelayer(v3, token);

        setVerifying(false);
        setVerificationStatus(verificationResult.status);
        setVerificationReason(verificationResult.reason);

        if (verificationResult.status === 'expired') {
          AlertManager.alert(
            'QR Code Expired',
            'This QR code has expired. Ask the merchant to generate a new one.',
            [{ text: 'Scan Again', onPress: resetScan }]
          );
          return;
        }

        if (verificationResult.status === 'invalid') {
          AlertManager.alert(
            'Invalid QR Code',
            verificationResult.reason || 'This QR code could not be verified. Do not proceed.',
            [{ text: 'Scan Again', onPress: resetScan }]
          );
          return;
        }

        // verified or unverified (relayer unreachable) – proceed with a brief pause
        // so the user can see the verification badge
        await new Promise(r => setTimeout(r, 800));

        navigation.replace('SendMoney', {
          recipientAddress: v3.merchant,
          amount: v3.amount && v3.amount !== '0' ? v3.amount : undefined,
          recipientName: v3.name,
          note: v3.note,
          merchantId: v3.merchantId,
          isMerchantPayment: true,
          isFromQR: true,
          qrVerified: verificationResult.status === 'verified',
          hideBalance: route?.params?.returnTo !== 'SendMoney',
        });
        return;
      }

      // -----------------------------------------------------------------------
      // 5. v2 legacy path – structural check only, show deprecation notice
      // -----------------------------------------------------------------------
      const v2 = parsed as PaymentQRData;
      if (v2.merchantId) {
        AlertManager.alert(
          'QR code no longer supported',
          'This older payment QR format is no longer supported. Ask the recipient to share a new QR code.',
          [{ text: 'Scan Again', onPress: resetScan }]
        );
        return;
      }
      const v2Check = validatePaymentQR(v2);
      if (!v2Check.valid) {
        AlertManager.alert('Invalid Payment', v2Check.error || 'Invalid payment data', [
          { text: 'Scan Again', onPress: resetScan },
        ]);
        return;
      }

      setLoading(false);
      setVerificationStatus('unverified');
      setVerificationReason('Legacy QR – not tamper-evident');

      // Show the badge briefly, then navigate
      await new Promise(r => setTimeout(r, 600));

      navigation.replace('SendMoney', {
        recipientAddress: v2.merchant,
        amount: v2.amount && v2.amount !== '0' ? v2.amount : undefined,
        recipientName: v2.name,
        note: v2.note,
        merchantId: v2.merchantId,
        isMerchantPayment: !!v2.merchantId,
        isFromQR: true,
        qrVerified: false,
        hideBalance: route?.params?.returnTo !== 'SendMoney',
      });
    } catch (error) {
      Logger.error('Error processing QR code:', error);
      setLoading(false);
      setVerifying(false);
      AlertManager.alert('Error', 'Failed to process QR code. Please try again.', [
        { text: 'Scan Again', onPress: resetScan },
      ]);
    }
  };

  const handlePickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 1,
      });

      if (!result.canceled && result.assets && result.assets[0]) {
        setScanned(true);
        setLoading(true);

        const qrResults = await Camera.scanFromURLAsync(result.assets[0].uri, ['qr']);
        const qrData = qrResults.find((qr) => qr.data)?.data;

        if (!qrData) {
          setLoading(false);
          AlertManager.alert(
            'No QR Code Found',
            'Please choose a clear image that contains a C-Pay QR code.',
            [{ text: 'Try Again', onPress: resetScan }]
          );
          return;
        }

        await handleBarCodeScanned({
          type: qrResults[0]?.type || 'qr',
          data: qrData,
        });
      }
    } catch (error) {
      Logger.error('Error picking image:', error);
      setLoading(false);
      AlertManager.alert('Error', 'Failed to scan QR code from this image.', [
        { text: 'Try Again', onPress: resetScan },
      ]);
    }
  };

  const handleCancel = () => {
    navigation.goBack();
  };

  if (hasPermission === null) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>Requesting camera permission...</Text>
      </View>
    );
  }

  if (hasPermission === false) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>No access to camera</Text>
        <Text style={styles.submessage}>
          Please enable camera permissions in your device settings
        </Text>
        <TouchableOpacity style={styles.button} onPress={handleCancel}>
          <Text style={styles.buttonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const footerInstruction = verifying
    ? 'Verifying merchant...'
    : scanned
    ? 'Processing...'
    : 'Align QR code within the frame';

  return (
    <View style={styles.container}>
      <CameraView
        style={styles.camera}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
      />

      {/* Header */}
      <View style={[styles.header, { paddingTop: headerTopPadding }]}>
        <Text style={styles.headerText}>Scan QR Code to Pay</Text>
      </View>

      {/* Scanner frame overlay */}
      <View style={styles.overlay}>
        <View style={[styles.scannerContainer, { width: scannerSize, height: scannerSize }]}>
          <View style={styles.scannerFrame}>
            <View style={[styles.corner, styles.cornerTopLeft]} />
            <View style={[styles.corner, styles.cornerTopRight]} />
            <View style={[styles.corner, styles.cornerBottomLeft]} />
            <View style={[styles.corner, styles.cornerBottomRight]} />
          </View>
        </View>

        {/* Verification badge – sits just below the scanner frame */}
        {verificationStatus !== null && (
          <View style={styles.badgeContainer}>
            <VerificationBadge
              status={verificationStatus}
              reason={verificationReason}
            />
          </View>
        )}
      </View>

      {/* Footer */}
      <View style={[styles.footer, { paddingBottom: footerBottomPadding }]}>
        {loading || verifying ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={COLORS.primary} />
            <Text style={styles.instruction}>
              {verifying ? 'Verifying merchant...' : 'Loading payment details...'}
            </Text>
          </View>
        ) : (
          <Text style={styles.instruction}>{footerInstruction}</Text>
        )}
        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.galleryButton} onPress={handlePickImage}>
            <Ionicons name="images-outline" size={18} color={COLORS.textInverse} />
            <Text style={styles.galleryButtonText}>Gallery</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelButton} onPress={handleCancel}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const styles = createThemedStyles((COLORS) => ({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  camera: {
    flex: 1,
    width: '100%',
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.md,
    backgroundColor: COLORS.overlayStrong,
    zIndex: 1,
  },
  headerText: {
    fontSize: FONT_SIZES.xl,
    fontWeight: '600',
    color: COLORS.textInverse,
    textAlign: 'center',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scannerContainer: {
    maxWidth: '82%',
    maxHeight: '42%',
  },
  scannerFrame: {
    width: '100%',
    height: '100%',
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderColor: COLORS.textInverse,
  },
  cornerTopLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: BORDER_RADIUS.md,
  },
  cornerTopRight: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: BORDER_RADIUS.md,
  },
  cornerBottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: BORDER_RADIUS.md,
  },
  cornerBottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: BORDER_RADIUS.md,
  },
  badgeContainer: {
    marginTop: SPACING.md,
    alignItems: 'center',
  },
  verificationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs + 2,
    borderRadius: BORDER_RADIUS.full,
  },
  verificationBadgeText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    backgroundColor: COLORS.overlayStrong,
    alignItems: 'center',
    zIndex: 1,
  },
  instruction: {
    fontSize: FONT_SIZES.md,
    color: COLORS.textInverse,
    textAlign: 'center',
    marginBottom: SPACING.md,
    fontWeight: '500',
    marginLeft: SPACING.sm,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: SPACING.md,
  },
  galleryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    backgroundColor: COLORS.whiteOverlay,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 2,
    borderColor: COLORS.textInverse,
    flex: 1,
  },
  galleryButtonText: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: COLORS.textInverse,
    textAlign: 'center',
  },
  cancelButton: {
    backgroundColor: COLORS.whiteOverlay,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 2,
    borderColor: COLORS.textInverse,
    flex: 1,
  },
  cancelButtonText: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: COLORS.textInverse,
    textAlign: 'center',
  },
  message: {
    fontSize: FONT_SIZES.lg,
    color: COLORS.textPrimary,
    marginBottom: SPACING.md,
    textAlign: 'center',
    fontWeight: '600',
  },
  submessage: {
    fontSize: FONT_SIZES.md,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginBottom: SPACING.xl,
    paddingHorizontal: SPACING.lg,
  },
  button: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
  },
  buttonText: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: COLORS.textInverse,
  },
}));
