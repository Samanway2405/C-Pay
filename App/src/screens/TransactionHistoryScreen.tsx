import React, { useState, useEffect } from 'react';

// Transaction history screen: reviews prior payments and wallet activity.
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { getTransactions, Transaction } from '../services/storage';
import { pollPendingTransactions } from '../services/transactionMonitor';
import { supabase } from '../services/supabase';
import { COLORS, SPACING, FONT_SIZES, BORDER_RADIUS, SHADOWS } from '../constants/theme';
import { TransactionItem, LoadingSpinner, EmptyState, TransactionDetailModal, Screen, Header } from '../components';

interface TransactionHistoryScreenProps {
  navigation: any;
  route?: {
    params?: {
      highlightTransaction?: string;
    };
  };
}

export const TransactionHistoryScreen: React.FC<TransactionHistoryScreenProps> = ({
  navigation,
  route,
}) => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [currentWallet, setCurrentWallet] = useState<string>('');
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [showTransactionModal, setShowTransactionModal] = useState(false);
  
  useEffect(() => {
    loadWalletAddress();
    loadTransactions();

    // If a specific transaction should be highlighted, show it
    if (route?.params?.highlightTransaction) {
      // Wait for transactions to load, then show the modal
      const timer = setTimeout(() => {
        const highlightedTx = transactions.find(
          tx => tx.tx_hash === route.params?.highlightTransaction
        );
        if (highlightedTx) {
          setSelectedTransaction(highlightedTx);
          setShowTransactionModal(true);
        }
      }, 500);
      return () => clearTimeout(timer);
    }

    // Subscribe to real-time updates from Supabase
    console.log('📡 Subscribing to real-time transaction updates...');
    
    const channel = supabase
      .channel('transactions_channel')
      .on(
        'postgres_changes',
        { 
          event: 'INSERT', 
          schema: 'public', 
          table: 'transactions' 
        },
        (payload) => {
          console.log('🆕 New transaction received:', payload.new);
          setTransactions((prev) => [payload.new as Transaction, ...prev]);
        }
      )
      .on(
        'postgres_changes',
        { 
          event: 'UPDATE', 
          schema: 'public', 
          table: 'transactions' 
        },
        (payload) => {
          console.log('🔄 Transaction updated:', payload.new);
          setTransactions((prev) =>
            prev.map((tx) =>
              tx.tx_hash === (payload.new as Transaction).tx_hash
                ? (payload.new as Transaction)
                : tx
            )
          );
        }
      )
      .subscribe((status) => {
        console.log('📡 Supabase subscription status:', status);
        if (status === 'SUBSCRIBED') {
          setRealtimeConnected(true);
          console.log('✅ Real-time connection established');
        } else if (status === 'CLOSED') {
          setRealtimeConnected(false);
          console.log('❌ Real-time connection closed');
        }
      });

    // Cleanup subscription on unmount
    return () => {
      console.log('📡 Unsubscribing from real-time updates...');
      channel.unsubscribe();
    };
  }, []);

  // Refresh transactions when screen comes into focus
  useFocusEffect(
    React.useCallback(() => {
      console.log('🔄 TransactionHistory focused - refreshing');
      loadTransactions();
    }, [])
  );

  const loadWalletAddress = async () => {
    const address = await AsyncStorage.getItem('wallet_address');
    if (address) {
      setCurrentWallet(address);
    }
  };

  const loadTransactions = async () => {
    try {
      const txs = await getTransactions();
      setTransactions(txs);
    } catch (error) {
      console.error('Error loading transactions:', error);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    
    // Reload transactions from Supabase
    await loadTransactions();
    
    // Manually poll pending transactions to update their status
    console.log('🔄 Manual refresh: checking pending transactions...');
    await pollPendingTransactions();
    
    setRefreshing(false);
  };

  if (loading) {
    return <LoadingSpinner fullScreen text="Loading transactions..." />;
  }

  return (
    <Screen
      scroll={false}
      padded={false}
      header={
        <Header
          title="Transactions"
          onBack={() => navigation.goBack()}
          right={
            realtimeConnected ? (
              <View style={styles.liveIndicator}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>Live</Text>
              </View>
            ) : undefined
          }
        />
      }
    >
      {/* Transaction List */}
      {transactions.length === 0 ? (
        <EmptyState
          icon="receipt-outline"
          title="No Transactions Yet"
          description="Your transaction history will appear here once you make or receive payments"
          actionText="Make a Payment"
          onAction={() => navigation.navigate('MainTabs', { screen: 'Home' })}
        />
      ) : (
        <FlatList
          data={transactions}
          renderItem={({ item }) => (
            <TransactionItem
              transaction={item}
              currentWallet={currentWallet}
              onPress={() => {
                setSelectedTransaction(item);
                setShowTransactionModal(true);
              }}
            />
          )}
          keyExtractor={(item) => item.tx_hash}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[COLORS.primary]}
              tintColor={COLORS.primary}
            />
          }
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Transaction Detail Modal */}
      <TransactionDetailModal
        visible={showTransactionModal}
        transaction={selectedTransaction}
        onClose={() => {
          setShowTransactionModal(false);
          setSelectedTransaction(null);
        }}
        currentWallet={currentWallet}
      />
    </Screen>
  );
};

const styles = StyleSheet.create({
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.success,
    marginRight: SPACING.xs,
  },
  liveText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.success,
    fontWeight: '500',
  },
  listContent: {
    padding: SPACING.lg,
  },
});

