import { useState, useRef } from 'react';
import { isValidAccountId } from '../services/blockchain';
import { getUserDisplayName } from '../services/storage';
import { getCPayIdByWallet, formatWalletFingerprint, isValidCPayId, getWalletAddressFromCPayId } from '../utils/cpayId';

export const useRecipientLookup = (walletAddress: string, isFromQR: boolean) => {
  const [recipientInput, setRecipientInput] = useState<string>('');
  const [recipientAddress, setRecipientAddress] = useState<string>('');
  const [recipientName, setRecipientName] = useState<string>('');
  const [recipientCPayId, setRecipientCPayId] = useState<string>('');
  const [fetchingRecipient, setFetchingRecipient] = useState<boolean>(false);
  const [recipientFetched, setRecipientFetched] = useState<boolean>(false);

  const recipientLookupSeq = useRef<number>(0);

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

  const handleAddressChange = async (input: string) => {
    setRecipientInput(input);

    if (!isFromQR) {
      setRecipientAddress('');
      setRecipientName('');
      setRecipientCPayId('');
      setRecipientFetched(false);
    }

    if (!isFromQR && isValidCPayId(input.trim())) {
      setFetchingRecipient(true);
      try {
        const walletAddr = await getWalletAddressFromCPayId(input.trim());
        if (walletAddr) {
          setRecipientAddress(walletAddr);
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

    setRecipientAddress(input);

    if (!isFromQR && isValidAccountId(input)) {
      fetchRecipientName(input);
    }
  };

  const resetRecipient = () => {
    setRecipientInput('');
    setRecipientAddress('');
    setRecipientName('');
    setRecipientCPayId('');
    setRecipientFetched(false);
  };

  return {
    recipientInput,
    setRecipientInput,
    recipientAddress,
    setRecipientAddress,
    recipientName,
    setRecipientName,
    recipientCPayId,
    setRecipientCPayId,
    fetchingRecipient,
    recipientFetched,
    fetchRecipientName,
    handleAddressChange,
    resetRecipient,
  };
};
