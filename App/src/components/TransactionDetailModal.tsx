import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Linking,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY, createThemedStyles, useTheme } from '../constants/theme';
import { convertAssetToINR, formatINR } from '../utils/currency';
import { formatDateLong } from '../utils/date';
import { formatWalletFingerprint, getCPayIdByWallet } from '../utils/cpayId';
import { formatTransactionHash, getExplorerUrl, isValidTransactionHash } from '../services/blockchain';
import { A11Y, TRANSACTION } from '../utils/strings';

const FONT_SIZES = TYPOGRAPHY.sizes;

export interface TransactionDetail {
  id?: string;
  transaction_id?: string;
  tx_hash?: string;
  from_address?: string;
  to_address?: string;
  amount: string;
  status: 'pending' | 'success' | 'failed';
  created_at?: string;
  merchant_name?: string;
  transaction_type?: 'personal' | 'merchant';
}

interface TransactionDetailModalProps {
  visible: boolean;
  transaction: TransactionDetail | null;
  onClose: () => void;
  currentWallet?: string;
  isMerchantView?: boolean;
}

export const TransactionDetailModal: React.FC<TransactionDetailModalProps> = ({
  visible,
  transaction,
  onClose,
  currentWallet,
  isMerchantView = false,
}) => {
  useTheme();
  const [fromCPayId, setFromCPayId] = useState<string>('');
  const [toCPayId, setToCPayId] = useState<string>('');

  // Load C-Pay IDs when transaction changes
  useEffect(() => {
    const loadCPayIds = async () => {
      if (transaction?.from_address) {
        const fromId = await getCPayIdByWallet(transaction.from_address);
        setFromCPayId(fromId || '');
      }
      if (transaction?.to_address) {
        const toId = await getCPayIdByWallet(transaction.to_address);
        setToCPayId(toId || '');
      }
    };

    if (transaction) {
      loadCPayIds();
    }
  }, [transaction]);

  if (!transaction) return null;

  const isReceived = transaction.to_address?.toLowerCase() === currentWallet?.toLowerCase();
  const amount = parseFloat(transaction.amount);

  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'success':
        return { label: 'Completed', icon: 'checkmark-circle', color: COLORS.transactionIncoming, bg: COLORS.transactionIncomingBg };
      case 'pending':
        return { label: 'Processing', icon: 'time', color: COLORS.warning, bg: COLORS.transactionPendingBg };
      case 'failed':
        return { label: 'Failed', icon: 'close-circle', color: COLORS.error, bg: COLORS.transactionFailedBg };
      default:
        return { label: 'Unknown', icon: 'help-circle', color: COLORS.textMuted, bg: COLORS.border };
    }
  };

  const statusConfig = getStatusConfig(transaction.status);
  const hasChainHash = isValidTransactionHash(transaction.tx_hash);

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    return formatDateLong(dateString);
  };

  const copyToClipboard = async (text: string) => {
    await Clipboard.setStringAsync(text);
    // Silent copy
  };

  const openExplorer = () => {
    if (hasChainHash) {
      const url = getExplorerUrl('tx', transaction.tx_hash!);
      Linking.openURL(url);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
      // Marks this as a modal so iOS screen readers trap focus inside it.
      accessibilityViewIsModal
    >
      <View style={styles.overlay}>
        <View
          style={styles.modalContainer}
          accessible
          accessibilityLabel={TRANSACTION.DETAILS_TITLE}
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{TRANSACTION.DETAILS_TITLE}</Text>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeButton}
              accessibilityRole="button"
              accessibilityLabel={A11Y.CLOSE_MODAL}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close" size={24} color={COLORS.text} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
            {/* Amount Section */}
            <View style={styles.amountSection}>
              <Text
                style={[
                  styles.amountValue,
                  { color: isMerchantView || isReceived ? COLORS.transactionIncoming : COLORS.text },
                ]}
                accessibilityLabel={`Amount: ${isMerchantView || isReceived ? 'received' : 'sent'} ${formatMoneyAmount(amount)}`}
                maxFontSizeMultiplier={1.3}
              >
                {isMerchantView || isReceived ? '+' : '-'}{formatMoneyAmount(amount)}
              </Text>
            </View>

            {/* Status Badge */}
            <View
              style={[styles.statusBadge, { backgroundColor: statusConfig.bg }]}
              accessibilityLabel={`Status: ${statusConfig.label}`}
              accessible
            >
              <Ionicons
                name={statusConfig.icon as any}
                size={20}
                color={statusConfig.color}
                accessibilityElementsHidden
                importantForAccessibility="no"
              />
              <Text style={[styles.statusText, { color: statusConfig.color }]}>
                {statusConfig.label}
              </Text>
            </View>

            {/* Transaction Details */}
            <View style={styles.detailsCard}>
              {/* Stellar transaction hash */}
              {hasChainHash && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>{TRANSACTION.HASH_LABEL}</Text>
                  <View style={styles.detailValueRow}>
                    <TouchableOpacity
                      style={styles.hashButton}
                      onPress={() => copyToClipboard(transaction.tx_hash!)}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={A11Y.COPY}
                      accessibilityHint={TRANSACTION.COPY_HASH_HINT}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={styles.detailValueHighlight}>
                        {formatTransactionHash(transaction.tx_hash)}
                      </Text>
                      <Ionicons
                        name="copy-outline"
                        size={16}
                        color={COLORS.primary}
                        accessibilityElementsHidden
                        importantForAccessibility="no"
                      />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.iconButton}
                      onPress={openExplorer}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={A11Y.VIEW_IN_EXPLORER}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="open-outline" size={16} color={COLORS.primary} />
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {/* Type */}
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>{TRANSACTION.TYPE_LABEL}</Text>
                <Text style={styles.detailValue}>
                  {isMerchantView
                    ? TRANSACTION.TYPE_PAYMENT_RECEIVED
                    : isReceived
                    ? TRANSACTION.TYPE_RECEIVED
                    : TRANSACTION.TYPE_SENT}
                </Text>
              </View>

              {/* Transaction Type - hide for merchant view and received transactions */}
              {transaction.transaction_type && !isMerchantView && !isReceived && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>{TRANSACTION.METHOD_LABEL}</Text>
                  <View
                    style={[
                      styles.typeBadge,
                      {
                        backgroundColor:
                          transaction.transaction_type === 'merchant'
                            ? COLORS.transactionMerchantBg
                            : COLORS.transactionTransferBg,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.typeText,
                        {
                          color:
                            transaction.transaction_type === 'merchant' ? COLORS.transactionMerchant : COLORS.transactionTransfer,
                        },
                      ]}
                    >
                      {transaction.transaction_type === 'merchant' ? 'Merchant QR' : 'Personal'}
                    </Text>
                  </View>
                </View>
              )}

              {/* Date */}
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>{TRANSACTION.DATE_TIME_LABEL}</Text>
                <Text style={styles.detailValue}>{formatDate(transaction.created_at)}</Text>
              </View>

              {/* From C-Pay ID */}
              {transaction.from_address && (
                <TouchableOpacity
                  style={styles.detailRow}
                  onPress={() =>
                    copyToClipboard(
                      fromCPayId || formatWalletFingerprint(transaction.from_address!)
                    )
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`${TRANSACTION.FROM_LABEL}: ${fromCPayId || formatWalletFingerprint(transaction.from_address)}`}
                  accessibilityHint={TRANSACTION.COPY_FROM_HINT}
                  hitSlop={{ top: 4, bottom: 4, left: 0, right: 0 }}
                >
                  <Text style={styles.detailLabel}>{TRANSACTION.FROM_LABEL}</Text>
                  <View style={styles.detailValueRow}>
                    <Text style={styles.addressText} numberOfLines={1}>
                      {fromCPayId || formatWalletFingerprint(transaction.from_address)}
                    </Text>
                    <Ionicons
                      name="copy-outline"
                      size={16}
                      color={COLORS.primary}
                      accessibilityElementsHidden
                      importantForAccessibility="no"
                    />
                  </View>
                </TouchableOpacity>
              )}

              {/* To C-Pay ID */}
              {transaction.to_address && (
                <TouchableOpacity
                  style={styles.detailRow}
                  onPress={() =>
                    copyToClipboard(
                      toCPayId || formatWalletFingerprint(transaction.to_address!)
                    )
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`${TRANSACTION.TO_LABEL}: ${toCPayId || formatWalletFingerprint(transaction.to_address)}`}
                  accessibilityHint={TRANSACTION.COPY_TO_HINT}
                  hitSlop={{ top: 4, bottom: 4, left: 0, right: 0 }}
                >
                  <Text style={styles.detailLabel}>{TRANSACTION.TO_LABEL}</Text>
                  <View style={styles.detailValueRow}>
                    <Text style={styles.addressText} numberOfLines={1}>
                      {toCPayId || formatWalletFingerprint(transaction.to_address)}
                    </Text>
                    <Ionicons
                      name="copy-outline"
                      size={16}
                      color={COLORS.primary}
                      accessibilityElementsHidden
                      importantForAccessibility="no"
                    />
                  </View>
                </TouchableOpacity>
              )}

              {/* Merchant Name - hide for merchant view and received transactions */}
              {transaction.merchant_name && !isMerchantView && !isReceived && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>{TRANSACTION.NOTE_LABEL}</Text>
                  <Text style={styles.detailValue}>{transaction.merchant_name}</Text>
                </View>
              )}
            </View>
          </ScrollView>

          {/* Close Button */}
          <TouchableOpacity
            style={styles.doneButton}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={TRANSACTION.DONE}
          >
            <Text style={styles.doneButtonText}>{TRANSACTION.DONE}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = createThemedStyles((COLORS) => ({
  overlay: {
    flex: 1,
    backgroundColor: COLORS.overlay,
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    paddingBottom: SPACING.xl,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  // Minimum 44×44 tap target for close button
  closeButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: SPACING.md,
  },
  amountSection: {
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  amountValue: {
    fontSize: 36,
    fontWeight: 'bold',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: 20,
    gap: 8,
    marginBottom: SPACING.lg,
    minHeight: 36,
  },
  statusText: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
  },
  detailsCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    // Minimum touch target height for tappable rows
    minHeight: 44,
  },
  detailLabel: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    flex: 1,
  },
  detailValue: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text,
    fontWeight: '500',
    flex: 2,
    textAlign: 'right',
  },
  detailValueHighlight: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary,
    fontWeight: '700',
  },
  detailValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 2,
    justifyContent: 'flex-end',
  },
  hashButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  iconButton: {
    padding: 2,
    minWidth: 32,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addressText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text,
    fontFamily: 'monospace',
  },
  typeBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: 6,
  },
  typeText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: '600',
  },
  doneButton: {
    backgroundColor: COLORS.primary,
    marginHorizontal: SPACING.md,
    padding: SPACING.md,
    borderRadius: 12,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  doneButtonText: {
    color: COLORS.textInverse,
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
  },
}));
