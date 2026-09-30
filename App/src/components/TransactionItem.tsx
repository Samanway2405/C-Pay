import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, FONT_SIZES, BORDER_RADIUS, SHADOWS, TYPOGRAPHY, createThemedStyles, useTheme } from '../constants/theme';
import { formatDateShort } from '../utils/date';
import { formatMoneyAmount } from '../utils/currency';
import { formatWalletFingerprint, getCPayIdByWallet } from '../utils/cpayId';
import { formatTransactionHash, isValidTransactionHash } from '../services/blockchain';
import { A11Y, TRANSACTION } from '../utils/strings';

interface Transaction {
  id?: string;
  tx_hash?: string;
  transaction_id?: string;
  merchant_name?: string;
  sender_name?: string;
  recipient_name?: string;
  to_address?: string;
  from_address?: string;
  amount: string;
  status: 'pending' | 'success' | 'failed';
  // Phase 2: Invisible Rail - simplified status for UI
  user_visible_status?: 'success' | 'failed';
  internal_status?: 'processing' | 'submitted' | 'confirmed' | 'failed';
  failure_reason?: string;
  created_at?: string;
}

interface TransactionItemProps {
  transaction: Transaction;
  onPress?: () => void;
  currentWallet?: string;
}

// Helper function to get status configuration.
// Surfaces the distinct lifecycle states so users can tell apart a payment
// that was just submitted, is pending network confirmation, is confirmed, or
// has failed.
const getStatusConfig = (status: string, internalStatus?: string) => {
  const submitted = {
    label: TRANSACTION.STATUS_SUBMITTED,
    a11yLabel: A11Y.STATUS_SUBMITTED,
    icon: 'paper-plane-outline' as const,
    color: COLORS.infoDark,
    bg: COLORS.infoBg,
  };
  const pending = {
    label: TRANSACTION.STATUS_PENDING,
    a11yLabel: A11Y.STATUS_PENDING,
    icon: 'time-outline' as const,
    color: COLORS.warningDark,
    bg: COLORS.warningBg,
  };
  const confirmed = {
    label: TRANSACTION.STATUS_CONFIRMED,
    a11yLabel: A11Y.STATUS_CONFIRMED,
    icon: 'checkmark-circle' as const,
    color: COLORS.successDark,
    bg: COLORS.successBg,
  };
  const failed = {
    label: TRANSACTION.STATUS_FAILED,
    a11yLabel: A11Y.STATUS_FAILED,
    icon: 'close-circle' as const,
    color: COLORS.errorDark,
    bg: COLORS.errorBg,
  };

  switch (status) {
    case 'success':
      if (internalStatus === 'submitted') return submitted;
      if (internalStatus === 'processing') return pending;
      // 'confirmed' or legacy success with no internal status
      return confirmed;
    case 'pending':
      if (internalStatus === 'submitted') return submitted;
      return pending;
    case 'failed':
      return failed;
    default:
      return {
        label: 'Unknown',
        a11yLabel: A11Y.STATUS_UNKNOWN,
        icon: 'help-circle' as const,
        color: COLORS.textMuted,
        bg: COLORS.background,
      };
  }
};

export const TransactionItem: React.FC<TransactionItemProps> = ({
  transaction,
  onPress,
  currentWallet,
}) => {
  useTheme();
  const [displayName, setDisplayName] = useState<string>('Loading...');
  const isReceived = transaction.to_address?.toLowerCase() === currentWallet?.toLowerCase();

  // Phase 2: Use user_visible_status if available, fallback to status
  const displayStatus = transaction.user_visible_status || transaction.status;
  const statusConfig = getStatusConfig(displayStatus, transaction.internal_status);
  const hasChainHash = isValidTransactionHash(transaction.tx_hash);

  const formatDate = (dateString: string) => formatDateShort(dateString);

  // Load display name (with C-Pay ID support)
  useEffect(() => {
    const loadDisplayName = async () => {
      if (isReceived) {
        // For received: show sender name or C-Pay ID
        if (transaction.sender_name) {
          setDisplayName(transaction.sender_name);
          return;
        }
        if (transaction.from_address) {
          const cpayId = await getCPayIdByWallet(transaction.from_address);
          setDisplayName(cpayId || formatWalletFingerprint(transaction.from_address));
          return;
        }
        setDisplayName('Unknown');
      } else {
        // For sent: show recipient name or C-Pay ID
        if (transaction.recipient_name || transaction.merchant_name) {
          setDisplayName(transaction.recipient_name || transaction.merchant_name || 'Unknown');
          return;
        }
        if (transaction.to_address) {
          const cpayId = await getCPayIdByWallet(transaction.to_address);
          setDisplayName(cpayId || formatWalletFingerprint(transaction.to_address));
          return;
        }
        setDisplayName('Unknown');
      }
    };

    loadDisplayName();
  }, [transaction, isReceived]);

  const amount = parseFloat(transaction.amount);
  const formattedAmount = formatMoneyAmount(amount);
  const directionLabel = isReceived ? 'Received from' : 'Sent to';

  // Compose a rich accessibility label so screen readers announce the full
  // transaction at once instead of reading individual sub-views.
  const itemAccessibilityLabel = A11Y.TRANSACTION_ITEM({
    direction: directionLabel,
    counterparty: displayName,
    amount: formattedAmount,
    status: statusConfig.a11yLabel,
  });

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={onPress}
      activeOpacity={0.7}
      accessible
      accessibilityRole="button"
      accessibilityLabel={itemAccessibilityLabel}
      accessibilityHint="Tap to view transaction details"
    >
      <View style={styles.transactionHeader}>
        <View style={styles.transactionInfo}>
          <View style={styles.transactionHashRow}>
            <Text style={styles.transactionId} importantForAccessibility="no-hide-descendants">
              {formatTransactionHash(transaction.tx_hash)}
            </Text>
            {hasChainHash && (
              <Ionicons
                name="open-outline"
                size={13}
                color={COLORS.primary}
                accessibilityElementsHidden
                importantForAccessibility="no"
              />
            )}
          </View>
          <Text style={styles.transactionName} numberOfLines={1} importantForAccessibility="no-hide-descendants">
            {isReceived ? 'From: ' : 'To: '}{displayName}
          </Text>
          <Text style={styles.transactionDate} importantForAccessibility="no-hide-descendants">
            {formatDate(transaction.created_at || new Date().toISOString())}
          </Text>
        </View>
        <View style={styles.transactionAmountContainer}>
          <Text
            style={[styles.transactionAmount, { color: isReceived ? COLORS.transactionIncoming : COLORS.text }]}
            importantForAccessibility="no-hide-descendants"
          >
            {isReceived ? '+' : '-'}{formattedAmount}
          </Text>
        </View>
      </View>
      <View style={styles.transactionFooter}>
        {/* Status badge is presentational; the accessible label above covers status */}
        <View
          style={[styles.statusBadge, { backgroundColor: statusConfig.bg }]}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          <Ionicons name={statusConfig.icon} size={14} color={statusConfig.color} />
          <Text style={[styles.statusText, { color: statusConfig.color }]}>
            {statusConfig.label}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = createThemedStyles((COLORS) => ({
  container: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    // Ensure minimum 44pt tap target height
    minHeight: 44,
  },
  transactionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: SPACING.sm,
  },
  transactionInfo: {
    flex: 1,
  },
  transactionHashRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 2,
  },
  transactionId: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '700',
    color: COLORS.primary,
    marginBottom: 2,
  },
  transactionName: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text,
    marginBottom: 2,
  },
  transactionDate: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.textMuted,
  },
  transactionAmountContainer: {
    alignItems: 'flex-end',
  },
  transactionAmount: {
    fontSize: FONT_SIZES.md,
    fontWeight: '700',
  },
  transactionFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: '600',
  },
}));
