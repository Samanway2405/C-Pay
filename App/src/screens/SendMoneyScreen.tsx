import React, { useState, useEffect, useRef } from 'react';

// Send money screen: user-driven transfer flow and recipient validation.
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  BackHandler,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { getBalance, isValidAccountId, transferTokens } from '../services/blockchain';
import { saveTransaction, getUserDisplayName } from '../services/storage';
import { getAuthenticatedWallet } from '../utils/biometric';
import { formatWalletFingerprint, getCPayIdByWallet, isValidCPayId, getWalletAddressFromCPayId } from '../utils/cpayId';
import { COLORS, SPACING, FONT_SIZES, BORDER_RADIUS, SHADOWS } from '../constants/theme';
import {
  Button,
  Screen,
  Header,
  FormField,
  AmountInput,
  InfoBanner,
  BottomActionBar,
  PaymentReviewSheet,
} from '../components';
import { AlertManager } from '../utils/alert';
import { MONEY_SYMBOL, MONEY_UNIT_LABEL, formatMoneyAmount } from '../utils/currency';
import { PILOT_TESTNET_TEXT } from '../utils/pilot';
import { getPaymentFailureCopy } from '../utils/paymentFailure';

interface SendMoneyScreenProps {
  navigation: any;
  route?: any;
}

export const SendMoneyScreen: React.FC<SendMoneyScreenProps> = ({ navigation, route }) => {
  const [walletAddress, setWalletAddress] = useState<string>('');
  const [recipientAddress, setRecipientAddress] = useState<string>('');
  const [recipientInput, setRecipientInput] = useState<string>(''); // Store original input (C-Pay ID or wallet)
  const [recipientName, setRecipientName] = useState<string>('');
  const [recipientCPayId, setRecipientCPayId] = useState<string>('');
  const [amount, setAmount] = useState<string>(''); // User enters pilot credit amount.
  const [note, setNote] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [balance, setBalance] = useState<string>('0');
  const [hideBalance, setHideBalance] = useState<boolean>(false);
  const [isFromQR, setIsFromQR] = useState<boolean>(false);
  const [hasPresetAmount, setHasPresetAmount] = useState<boolean>(false);
  const [fetchingRecipient, setFetchingRecipient] = useState<boolean>(false);
  const [recipientFetched, setRecipientFetched] = useState<boolean>(false);
  const [showReview, setShowReview] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const paymentInProgress = useRef<boolean>(false);
  const networkTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const recipientLookupSeq = useRef<number>(0);

  useEffect(() => {
    loadWalletData();
    const routeRecipientName = typeof route?.params?.recipientName === 'string'
      ? route.params.recipientName.trim()
      : '';

    // If coming from QR scan or deep link
    if (route?.params?.recipientAddress) {
      const address = route.params.recipientAddress;
      setRecipientAddress(address);
      setRecipientInput(address);
      if (isValidAccountId(address)) {
        void fetchRecipientName(address, {
          fallbackName: routeRecipientName,
        });
      }
    }
    if (routeRecipientName) {
      setRecipientName(routeRecipientName);
    }
    if (route?.params?.amount && parseFloat(route.params.amount) > 0) {
      // Amount is already in the user-visible credit unit.
      setAmount(parseFloat(route.params.amount).toFixed(2));
      setHasPresetAmount(true);
    }
    if (route?.params?.note) {
      setNote(route.params.note);
    }
    if (route?.params?.hideBalance === true) {
      setHideBalance(true);
    }
    if (route?.params?.isFromQR) {
      setIsFromQR(true);
    }
  }, [route?.params]);

  // Handle back button during payment
  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (paymentInProgress.current) {
        AlertManager.alert(
          'Transaction Cancelled',
          'Payment was interrupted. If the transaction was submitted, it may still complete.',
          [{ text: 'OK', onPress: () => navigation.goBack() }]
        );
        return true; // Prevent default back behavior
      }
      return false; // Allow default back behavior
    });

    return () => {
      backHandler.remove();
      if (networkTimeoutRef.current) {
        clearTimeout(networkTimeoutRef.current);
      }
    };
  }, []);

  const loadWalletData = async () => {
    try {
      const address = await AsyncStorage.getItem('wallet_address');
      if (address) {
        setWalletAddress(address);
        await loadBalance(address);
      }
    } catch (error) {
      console.error('Error loading wallet:', error);
    }
  };

  const loadBalance = async (address: string) => {
    try {
      const formatted = await getBalance(address);
      setBalance(parseFloat(formatted).toFixed(2));
    } catch (error) {
      console.error('Error loading balance:', error);
      setBalance('0.00');
    }
  };

  // Fetch recipient name when address is entered
  const fetchRecipientName = async (
    address: string,
    options: {
      fallbackName?: string;
    } = {}
  ) => {
    const lookupSeq = ++recipientLookupSeq.current;
    const fallbackName = options.fallbackName?.trim() || '';

    if (!address || !isValidAccountId(address)) {
      setRecipientName('');
      setRecipientCPayId('');
      setRecipientFetched(false);
      return;
    }

    // Don't fetch if same as user's wallet
    if (address === walletAddress) {
      setRecipientName('');
      setRecipientCPayId('');
      setRecipientFetched(false);
      return;
    }

    setFetchingRecipient(true);
    try {
      const [name, cpayId] = await Promise.all([
        getUserDisplayName(address),
        getCPayIdByWallet(address),
      ]);

      if (lookupSeq !== recipientLookupSeq.current) {
        return;
      }

      const displayName = name || fallbackName;
      if (displayName) {
        setRecipientName(displayName);
        setRecipientCPayId(cpayId || formatWalletFingerprint(address));
        setRecipientFetched(true);
      } else {
        setRecipientName('');
        setRecipientCPayId(formatWalletFingerprint(address));
        setRecipientFetched(false);
      }
    } catch (error) {
      console.log('Error fetching recipient name:', error);
      setRecipientName('');
      setRecipientCPayId('');
      setRecipientFetched(false);
    } finally {
      if (lookupSeq === recipientLookupSeq.current) {
        setFetchingRecipient(false);
      }
    }
  };

  // Handle address input change - auto-fetch when valid address or C-Pay ID is entered
  const handleAddressChange = async (input: string) => {
    setRecipientInput(input);

    // Clear previous recipient info when address changes
    if (!isFromQR) {
      setRecipientAddress('');
      setRecipientName('');
      setRecipientCPayId('');
      setRecipientFetched(false);
    }

    // Check if input is a valid C-Pay ID
    if (!isFromQR && isValidCPayId(input.trim())) {
      setFetchingRecipient(true);
      try {
        // Look up wallet address from C-Pay ID
        const walletAddr = await getWalletAddressFromCPayId(input.trim());
        if (walletAddr) {
          setRecipientAddress(walletAddr);
          // Fetch name and C-Pay ID
          await fetchRecipientName(walletAddr);
        } else {
          setRecipientAddress('');
          setRecipientName('');
          setRecipientCPayId('');
          setRecipientFetched(false);
        }
      } catch (error) {
        console.error('Error looking up C-Pay ID:', error);
      } finally {
        setFetchingRecipient(false);
      }
      return;
    }

    // Otherwise treat as wallet address
    setRecipientAddress(input);

    if (!isFromQR && isValidAccountId(input)) {
      fetchRecipientName(input);
    }
  };

  const validateInputs = (): boolean => {
    if (!recipientInput.trim() && !recipientAddress.trim()) {
      AlertManager.alert('Invalid C-Pay ID', 'Please enter a recipient C-Pay ID');
      return false;
    }

    // If recipient address is not set yet (C-Pay ID lookup failed or in progress)
    if (!recipientAddress.trim()) {
      AlertManager.alert('Invalid C-Pay ID', 'Could not find an account for the entered C-Pay ID');
      return false;
    }

    if (!isValidAccountId(recipientAddress.trim())) {
      AlertManager.alert('Invalid C-Pay ID', 'Please enter a valid C-Pay ID');
      return false;
    }

    if (recipientAddress.trim() === walletAddress) {
      AlertManager.alert('Invalid Recipient', 'You cannot send pilot credits to yourself');
      return false;
    }

    const amountNum = parseFloat(amount);
    if (!amount || isNaN(amountNum) || amountNum <= 0) {
      AlertManager.alert('Invalid Amount', 'Please enter a valid amount');
      return false;
    }

    const balanceNum = parseFloat(balance);
    if (amountNum > balanceNum) {
      AlertManager.alert('Insufficient Balance', `You only have ${formatMoneyAmount(parseFloat(balance))}`);
      return false;
    }

    return true;
  };

  // Open the unified review sheet (shared by manual send and scan-to-pay).
  const handleSendMoney = () => {
    if (submitting || paymentInProgress.current) return;
    if (!validateInputs()) return;
    setShowReview(true);
  };

  // Executed after the user confirms in the review sheet. Performs wallet
  // unlock and submits the payment, then routes to the processing/result flow.
  const executePayment = async () => {
    if (paymentInProgress.current) return;

    const effectiveRecipientName = recipientName;
    const effectiveRecipientCPayId = recipientCPayId;
    const displayId = effectiveRecipientCPayId || formatWalletFingerprint(recipientAddress);

    const timestamp = () =>
      new Date().toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });

    try {
      setSubmitting(true);
      // Close the review sheet BEFORE wallet unlock. The PIN dialog is itself a
      // modal, and stacking modals fails on iOS — so we dismiss the sheet first
      // and show the screen's own loading state during authentication/submit.
      setShowReview(false);
      paymentInProgress.current = true;

      // Set timeout for slow network detection.
      networkTimeoutRef.current = setTimeout(() => {
        if (paymentInProgress.current) {
          AlertManager.alert(
            'Slow Network Detected',
            'Your network connection is slow. The payment is still processing...',
            [{ text: 'OK' }]
          );
        }
      }, 10000);

      const wallet = await getAuthenticatedWallet(
        'Confirm Payment',
        'Enter your 6-digit PIN to send pilot credits',
        'Unlock wallet to send pilot credits'
      );
      if (!wallet) {
        paymentInProgress.current = false;
        if (networkTimeoutRef.current) clearTimeout(networkTimeoutRef.current);
        setSubmitting(false);
        AlertManager.alert('Authentication Failed', 'Transaction cancelled');
        return;
      }

      // Navigate to Processing screen immediately.
      const startTime = Date.now();

      navigation.replace('PaymentProcessing', {
        amount: amount,
        recipientName: effectiveRecipientName || displayId,
        recipientAddress: recipientAddress.trim(),
      });

      const txHash = await transferTokens(
        wallet,
        recipientAddress.trim(),
        amount,
        {
          note,
        }
      );

      // Clear timeout on success
      if (networkTimeoutRef.current) clearTimeout(networkTimeoutRef.current);
      paymentInProgress.current = false;

      // Calculate processing time
      const processingTime = Math.round((Date.now() - startTime) / 1000);

      // Save transaction locally and sync to Supabase
      const senderName = await AsyncStorage.getItem('user_name');

      const transactionData = {
        tx_hash: txHash,
        to_address: recipientAddress.trim(),
        from_address: walletAddress,
        amount: amount,
        status: 'pending' as const,
        internal_status: 'submitted' as const,
        recipient_name: effectiveRecipientName || undefined,
        sender_name: senderName || undefined,
        note: note || undefined, // Separate note field
        created_at: new Date().toISOString(),
        submitted_at: new Date().toISOString(),
        transaction_type: 'personal' as const,
      };

      saveTransaction(transactionData)
        .then(() => console.log('✅ Transaction saved and synced'))
        .catch(err => console.error('❌ Transaction save/sync error:', err));

      // Navigate to Success screen
      navigation.replace('PaymentSuccess', {
        transactionHash: txHash,
        fromAddress: walletAddress,
        amount: amount,
        recipientName: effectiveRecipientName || displayId,
        recipientAddress: recipientAddress.trim(),
        processingTime: processingTime || 2,
        timestamp: timestamp(),
        note: note || undefined,
      });
    } catch (error: any) {
      // Clear timeout on error
      if (networkTimeoutRef.current) clearTimeout(networkTimeoutRef.current);
      paymentInProgress.current = false;
      setSubmitting(false);

      const copy = getPaymentFailureCopy(error);

      // Navigate to Failure screen
      navigation.replace('PaymentFailure', {
        amount: amount,
        recipientName: effectiveRecipientName || displayId,
        recipientAddress: recipientAddress.trim(),
        errorMessage: copy.errorMessage,
        errorReason: copy.errorReason,
        errorCode: copy.errorCode,
        category: copy.category,
        timestamp: timestamp(),
      });
    }
  };

  const handlePasteAddress = async () => {
    try {
      const { default: Clipboard } = await import('expo-clipboard');
      const text = await Clipboard.getStringAsync();
      if (text && isValidAccountId(text.trim())) {
        const address = text.trim();
        setRecipientAddress(address);
        setRecipientInput(address);
        fetchRecipientName(address);
      } else {
        AlertManager.alert('Invalid Address', 'Clipboard does not contain a valid address');
      }
    } catch (error) {
      AlertManager.alert('Error', 'Failed to paste from clipboard');
    }
  };

  const handleBackPress = () => {
    if (paymentInProgress.current) {
      AlertManager.alert(
        'Transaction Cancelled',
        'Payment was interrupted. If the transaction was submitted, it may still complete.',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } else {
      navigation.goBack();
    }
  };

  return (
    <Screen
      preset="scroll"
      loading={loading || submitting}
      loadingText="Processing payment..."
      header={<Header title="Send Pilot Credits" onBack={handleBackPress} />}
      bottomAction={
        <BottomActionBar>
          <Button
            title={`Send ${amount ? formatMoneyAmount(parseFloat(amount)) : MONEY_UNIT_LABEL}`}
            onPress={handleSendMoney}
            variant="primary"
            size="lg"
            fullWidth
            disabled={
              loading ||
              submitting ||
              fetchingRecipient ||
              !recipientAddress.trim() ||
              !amount ||
              parseFloat(amount) <= 0
            }
          />
        </BottomActionBar>
      }
    >
      {/* Balance Card - Hidden when scanned from other places */}
      {!hideBalance && (
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Available Credits</Text>
          <View style={styles.balanceRow}>
            <Text style={styles.balanceCurrency}>{MONEY_SYMBOL}</Text>
            <Text style={styles.balanceAmount}>{parseFloat(balance).toFixed(2)}</Text>
          </View>
        </View>
      )}

      {/* Recipient Info Card - Show when from QR scan OR when name is fetched */}
      {((isFromQR && recipientName) || recipientFetched) && (
        <View style={styles.recipientCard}>
          <View style={styles.recipientCardHeader}>
            <Ionicons
              name="person-outline"
              size={23}
              color={COLORS.primary}
              style={styles.recipientCardIcon}
            />
            <Text style={styles.recipientCardTitle}>
              Sending To
            </Text>
          </View>
          <View style={styles.recipientCardContent}>
            <Text style={styles.recipientCardName} numberOfLines={1}>{recipientName}</Text>
            <Text style={styles.recipientCardAddress} numberOfLines={1}>
              {recipientCPayId || formatWalletFingerprint(recipientAddress)}
            </Text>
          </View>
        </View>
      )}

      {/* Recipient Address Input - Hide when recipient is fetched or from QR */}
      {!isFromQR && !recipientFetched && (
        <FormField
          label="Recipient C-Pay ID"
          containerStyle={styles.field}
          placeholder="name@cpayk8f3qz"
          value={recipientInput}
          onChangeText={handleAddressChange}
          autoCapitalize="none"
          autoCorrect={false}
          monospace
          leftIcon="person-outline"
          rightAction={{
            icon: 'clipboard-outline',
            onPress: handlePasteAddress,
            accessibilityLabel: 'Paste recipient address',
          }}
          helper={fetchingRecipient ? 'Looking up recipient...' : undefined}
        />
      )}

      {/* Change Recipient Button - Show when recipient is fetched (not from QR) */}
      {!isFromQR && recipientFetched && (
        <TouchableOpacity
          style={styles.changeRecipientButton}
          onPress={() => {
            setRecipientInput('');
            setRecipientAddress('');
            setRecipientName('');
            setRecipientCPayId('');
            setRecipientFetched(false);
          }}
        >
          <Text style={styles.changeRecipientText}>Change Recipient</Text>
        </TouchableOpacity>
      )}

      {/* Amount Input */}
      <AmountInput
        label="Amount"
        containerStyle={styles.field}
        value={amount}
        onChangeText={setAmount}
        editable={!hasPresetAmount}
        quickAmounts={['10', '50', '100', '500']}
      />

      {/* Note Input (Optional) */}
      <FormField
        label="Add Note (Optional)"
        containerStyle={styles.field}
        placeholder="e.g., Lunch payment, Rent, etc."
        value={note}
        onChangeText={setNote}
        maxLength={50}
      />

      {/* Info */}
      <InfoBanner
        variant="info"
        message={`${PILOT_TESTNET_TEXT} Payments typically confirm in 5-10 seconds.`}
      />

      {/* Unified payment review (shared by manual send and scan-to-pay) */}
      <PaymentReviewSheet
        visible={showReview}
        recipientName={recipientName}
        cpayId={recipientCPayId || formatWalletFingerprint(recipientAddress)}
        amount={amount}
        note={note}
        submitting={submitting}
        onConfirm={executePayment}
        onCancel={() => {
          if (!submitting) setShowReview(false);
        }}
      />
    </Screen>
  );
};

const styles = StyleSheet.create({
  field: {
    marginBottom: SPACING.xl,
  },
  balanceCard: {
    backgroundColor: COLORS.primary,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.xl,
    ...SHADOWS.md,
  },
  balanceLabel: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textInverse,
    opacity: 0.8,
    marginBottom: SPACING.xs,
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  balanceAmount: {
    fontSize: 36,
    fontWeight: '700',
    color: COLORS.textInverse,
    marginRight: SPACING.sm,
  },
  balanceCurrency: {
    fontSize: FONT_SIZES.lg,
    color: COLORS.textInverse,
    opacity: 0.9,
    fontWeight: '600',
    marginRight: SPACING.xs,
  },
  recipientCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.xl,
    borderWidth: 2,
    borderColor: COLORS.primary,
    ...SHADOWS.md,
  },
  recipientCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  recipientCardIcon: {
    marginRight: SPACING.sm,
  },
  recipientCardTitle: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  recipientCardContent: {
    marginLeft: 36,
  },
  recipientCardName: {
    fontSize: FONT_SIZES.xl,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: SPACING.xs,
  },
  recipientCardAddress: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textSecondary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  changeRecipientButton: {
    alignSelf: 'flex-start',
    marginBottom: SPACING.lg,
  },
  changeRecipientText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
});
