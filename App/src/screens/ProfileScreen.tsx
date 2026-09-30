import React, { useState, useEffect, useRef } from 'react';

// Profile screen: wallet identity, photo, and account settings.
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Switch,
  Image,
  Platform,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import AsyncStorage from '@react-native-async-storage/async-storage';
import QRCode from 'react-native-qrcode-svg';
import ViewShot from 'react-native-view-shot';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../services/supabase';
import { COLORS, SPACING, FONT_SIZES, BORDER_RADIUS, SHADOWS } from '../constants/theme';
import { Screen, Section, ActionRow } from '../components';
import { AlertManager } from '../utils/alert';
import { formatWalletFingerprint, getCurrentUserCPayId } from '../utils/cpayId';
import { getMediaLibraryDownloadErrorMessage, requestPhotoSavePermission } from '../utils/mediaLibrary';
import { clearSessionPin } from '../services/wallet';
import { generatePaymentQR } from '../utils/qrCode';

interface ProfileScreenProps {
  navigation: any;
}

export const ProfileScreen: React.FC<ProfileScreenProps> = ({ navigation }) => {
  const [walletAddress, setWalletAddress] = useState<string>('');
  const [cpayId, setCpayId] = useState<string>('');
  const [displayName, setDisplayName] = useState<string>('');
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(true);
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);
  const [showQRCode, setShowQRCode] = useState<boolean>(false);
  const qrCodeRef = useRef<any>(null);

  useEffect(() => {
    loadWalletAddress();
    loadCPayId();
    loadDisplayName();
    loadSettings();
    loadProfilePhoto();

    return undefined;
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      loadCPayId();
      loadDisplayName();
      loadProfilePhoto();
      loadSettings();
    }, [])
  );

  const loadWalletAddress = async () => {
    const address = await AsyncStorage.getItem('wallet_address');
    if (address) setWalletAddress(address);
  };

  const loadCPayId = async () => {
    const id = await getCurrentUserCPayId();
    if (id) setCpayId(id);
  };

  const loadDisplayName = async () => {
    try {
      const address = await AsyncStorage.getItem('wallet_address');
      if (!address) return;

      const { data, error } = await supabase
        .from('users')
        .select('display_name')
        .eq('wallet_address', address)
        .single();

      if (!error && data?.display_name) {
        setDisplayName(data.display_name);
        await AsyncStorage.setItem('display_name', data.display_name);
      } else {
        const localName = await AsyncStorage.getItem('display_name');
        if (localName) setDisplayName(localName);
      }
    } catch (error) {
      console.error('Error loading display name:', error);
      const localName = await AsyncStorage.getItem('display_name');
      if (localName) setDisplayName(localName);
    }
  };

  const loadSettings = async () => {
    const notifSetting = await AsyncStorage.getItem('notifications_enabled');
    setNotificationsEnabled(notifSetting !== 'false');
  };

  const loadProfilePhoto = async () => {
    try {
      const address = await AsyncStorage.getItem('wallet_address');
      if (!address) return;

      const { data, error } = await supabase
        .from('users')
        .select('profile_photo_url')
        .eq('wallet_address', address)
        .single();

      if (!error && data?.profile_photo_url) {
        setProfilePhoto(data.profile_photo_url);
      } else {
        const localPhoto = await AsyncStorage.getItem('profile_photo');
        if (localPhoto) setProfilePhoto(localPhoto);
      }
    } catch (error) {
      console.error('Error loading profile photo:', error);
    }
  };

  const handlePickImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        AlertManager.alert('Permission Required', 'Please allow access to your photos to change your profile picture.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.5,
      });

      if (!result.canceled && result.assets[0]) {
        const photoUri = result.assets[0].uri;
        AlertManager.alert('Uploading', 'Uploading your profile photo...');
        const uploaded = await uploadProfilePhoto(photoUri);
        if (uploaded) {
          setProfilePhoto(uploaded);
          AlertManager.alert('Success', 'Profile photo updated and synced to cloud!', undefined, { type: 'success' });
        } else {
          setProfilePhoto(photoUri);
          await AsyncStorage.setItem('profile_photo', photoUri);
          AlertManager.alert('Saved Locally', 'Photo saved on device. Cloud sync unavailable.');
        }
      }
    } catch (error) {
      console.error('Error picking image:', error);
      AlertManager.alert('Error', 'Failed to update profile photo', undefined, { type: 'error' });
    }
  };

  const uploadProfilePhoto = async (photoUri: string): Promise<string | null> => {
    try {
      const address = await AsyncStorage.getItem('wallet_address');
      if (!address) return null;

      const base64 = await fetch(photoUri)
        .then(res => res.blob())
        .then(blob => {
          return new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const base64data = reader.result as string;
              resolve(base64data.split(',')[1]);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        });

      const fileExt = photoUri.split('.').pop()?.split('?')[0] || 'jpg';
      const fileName = `${address.substring(0, 8)}_${Date.now()}.${fileExt}`;
      const filePath = `profile-photos/${fileName}`;

      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const { error: uploadError } = await supabase.storage
        .from('profile-images')
        .upload(filePath, bytes.buffer, {
          contentType: `image/${fileExt}`,
          upsert: true,
        });

      if (uploadError) {
        console.error('Upload error details:', uploadError);
        return null;
      }

      const { data: urlData } = supabase.storage
        .from('profile-images')
        .getPublicUrl(filePath);

      const publicUrl = urlData.publicUrl;

      const { error: dbError } = await supabase
        .from('users')
        .update({ profile_photo_url: publicUrl })
        .eq('wallet_address', address);

      if (dbError) console.error('Database update error:', dbError);

      await AsyncStorage.setItem('profile_photo', publicUrl);
      return publicUrl;
    } catch (error) {
      console.error('Error uploading profile photo:', error);
      return null;
    }
  };

  const handleCopyAddress = async () => {
    const idToCopy = cpayId || formatWalletFingerprint(walletAddress);
    await Clipboard.setStringAsync(idToCopy);
    AlertManager.alert('Copied', 'Your C-Pay ID was copied to the clipboard.', undefined, { type: 'success' });
  };

  const handleShowQRCode = () => setShowQRCode((current) => !current);

  const handleShareQRCode = async () => {
    try {
      if (!qrCodeRef.current) return;
      const uri = await qrCodeRef.current.capture();
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'image/png',
          dialogTitle: 'Scan this QR code to send me pilot credits on C-Pay.',
          UTI: 'public.png',
        });
      } else {
        AlertManager.alert('Not Available', 'Sharing is not available on this device');
      }
    } catch (error) {
      console.error('Error sharing QR code:', error);
      AlertManager.alert('Error', 'Failed to share QR code', undefined, { type: 'error' });
    }
  };

  const handleDownloadQRCode = async () => {
    try {
      const hasPermission = await requestPhotoSavePermission();
      if (!hasPermission) {
        AlertManager.alert('Permission Required', 'Please allow access to save the QR code to your gallery.');
        return;
      }
      if (qrCodeRef.current) {
        const uri = await qrCodeRef.current.capture();
        await MediaLibrary.createAssetAsync(uri);
        AlertManager.alert('Saved', 'QR code saved to your gallery.', undefined, { type: 'success' });
      }
    } catch (error) {
      console.error('Error downloading QR code:', error);
      AlertManager.alert('Error', getMediaLibraryDownloadErrorMessage(error), undefined, { type: 'error' });
    }
  };

  const handleToggleNotifications = async (value: boolean) => {
    setNotificationsEnabled(value);
    await AsyncStorage.setItem('notifications_enabled', value.toString());
  };

  const handleSignOut = () => {
    AlertManager.alert(
      'Sign Out',
      'Are you sure you want to sign out? You will need email verification and wallet unlock to access your account again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            await AsyncStorage.removeItem('auth_token');
            await AsyncStorage.removeItem('phone_verified');
            await AsyncStorage.removeItem('phone_number');
            await AsyncStorage.removeItem('email_verified');
            await AsyncStorage.removeItem('user_email');
            clearSessionPin();
            AlertManager.alert('Signed Out', 'You have been signed out successfully.', [
              { text: 'OK', onPress: () => navigation.replace('Splash') },
            ]);
          },
        },
      ]
    );
  };

  return (
    <Screen topInset={false}>
      {/* Identity */}
      <View style={styles.profileHeader}>
        <TouchableOpacity style={styles.profilePhotoContainer} onPress={handlePickImage}>
          <Image
            source={profilePhoto ? { uri: profilePhoto } : require('../../assets/default-profile-image-cryptopay.png')}
            style={styles.profilePhoto}
          />
          <View style={styles.editIconContainer}>
            <Ionicons name="camera-outline" size={15} color={COLORS.primary} />
          </View>
        </TouchableOpacity>

        {!!displayName && <Text style={styles.profileName}>{displayName}</Text>}
        <TouchableOpacity style={styles.addressContainer} onPress={handleCopyAddress} activeOpacity={0.7}>
          <Text style={styles.profileAddress}>{cpayId || formatWalletFingerprint(walletAddress)}</Text>
          <Ionicons name="copy-outline" size={20} color={COLORS.primary} />
        </TouchableOpacity>
      </View>

      {/* QR code */}
      <View style={styles.section}>
        <TouchableOpacity style={styles.qrCodeCard} onPress={handleShowQRCode} activeOpacity={0.8}>
          <View style={styles.qrCodeHeader}>
            <View style={styles.qrCodeHeaderLeft}>
              <Ionicons name="qr-code-outline" size={24} color={COLORS.primary} style={styles.qrCodeIcon} />
              <Text style={styles.qrCodeTitle}>My QR Code</Text>
            </View>
            <Ionicons name={showQRCode ? 'chevron-up' : 'chevron-down'} size={22} color={COLORS.textSecondary} />
          </View>

          {showQRCode && (
            <View style={styles.qrCodeContent}>
              <ViewShot ref={qrCodeRef} options={{ format: 'png', quality: 1.0 }}>
                <View style={styles.shareableQRCard}>
                  <View style={styles.shareCardProfile}>
                    <Image
                      source={profilePhoto ? { uri: profilePhoto } : require('../../assets/default-profile-image-cryptopay.png')}
                      style={styles.shareCardProfilePhoto}
                    />
                    {!!displayName && <Text style={styles.shareCardName}>{displayName}</Text>}
                    <Text style={styles.shareCardAddress}>{cpayId || formatWalletFingerprint(walletAddress)}</Text>
                  </View>

                  <View style={styles.qrCodeWrapper}>
                    <QRCode
                      value={generatePaymentQR(walletAddress, '0', displayName || 'C-Pay User', '')}
                      size={220}
                      backgroundColor="white"
                      color={COLORS.primary}
                      logo={require('../../assets/cpay_logo.png')}
                      logoSize={45}
                      logoBackgroundColor="white"
                      logoMargin={2}
                    />
                  </View>

                  <View style={styles.shareCardFooter}>
                    <Text style={styles.shareCardFooterText}>Scan to send pilot credits</Text>
                  </View>
                </View>
              </ViewShot>
              <Text style={styles.qrCodeDescription}>
                Let others scan this QR code to send you pilot credits
              </Text>

              <View style={styles.qrActionButtons}>
                <TouchableOpacity style={styles.qrActionButton} onPress={handleDownloadQRCode}>
                  <Ionicons name="download-outline" size={20} color={COLORS.text} />
                  <Text style={styles.qrActionButtonText}>Download</Text>
                </TouchableOpacity>

                <TouchableOpacity style={[styles.qrActionButton, styles.qrShareButton]} onPress={handleShareQRCode}>
                  <Ionicons name="share-social-outline" size={20} color={COLORS.textInverse} />
                  <Text style={[styles.qrActionButtonText, styles.shareButtonText]}>Share</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Security — kept near the top so security actions aren't buried */}
      <Section title="Security">
        <View style={styles.card}>
          <ActionRow
            style={styles.rowFlat}
            icon="shield-checkmark-outline"
            title="Security Center"
            subtitle="PIN, biometrics, backup, wallet keys"
            onPress={() => navigation.navigate('SecurityCenter')}
          />
        </View>
      </Section>

      {/* Wallet */}
      <Section title="Wallet">
        <View style={styles.card}>
          <ActionRow
            style={styles.rowFlat}
            icon="receipt-outline"
            title="Transaction history"
            subtitle="View all your payments"
            onPress={() => navigation.navigate('TransactionHistory')}
          />
        </View>
      </Section>

      {/* Preferences */}
      <Section title="Preferences">
        <View style={styles.card}>
          <ActionRow
            style={styles.rowFlat}
            icon="notifications-outline"
            title="Notifications"
            subtitle="Transaction alerts"
            right={
              <Switch
                value={notificationsEnabled}
                onValueChange={handleToggleNotifications}
                trackColor={{ false: COLORS.border, true: COLORS.primary + '50' }}
                thumbColor={notificationsEnabled ? COLORS.primary : COLORS.textSecondary}
              />
            }
          />
        </View>
      </Section>

      {/* Support */}
      <Section title="Support">
        <View style={styles.card}>
          <ActionRow
            style={styles.rowFlat}
            icon="chatbubble-ellipses-outline"
            title="Help & Support"
            subtitle="Guides and contact options"
            onPress={() => navigation.navigate('Info', { doc: 'support' })}
          />
        </View>
      </Section>

      {/* Legal */}
      <Section title="Legal">
        <View style={styles.card}>
          <ActionRow
            style={styles.rowFlat}
            icon="lock-closed-outline"
            title="Privacy Policy"
            onPress={() => navigation.navigate('Info', { doc: 'privacy' })}
          />
          <View style={styles.divider} />
          <ActionRow
            style={styles.rowFlat}
            icon="document-text-outline"
            title="Terms of Service"
            onPress={() => navigation.navigate('Info', { doc: 'terms' })}
          />
          <View style={styles.divider} />
          <ActionRow
            style={styles.rowFlat}
            icon="information-circle-outline"
            title="About"
            onPress={() => navigation.navigate('Info', { doc: 'about' })}
          />
        </View>
      </Section>

      {/* Sign out */}
      <View style={styles.signOutSection}>
        <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
          <Ionicons name="log-out-outline" size={20} color={COLORS.error} style={styles.signOutButtonIcon} />
          <Text style={styles.signOutButtonText}>Sign Out</Text>
        </TouchableOpacity>
        <Text style={styles.signOutHint}>Your wallet will be safe. Sign back in anytime.</Text>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>C-Pay v1.0.3</Text>
        <Text style={styles.footerSubtext}>Built for closed-pilot test payments</Text>
        <Text style={styles.footerSubtext}>Stellar Testnet</Text>
      </View>
    </Screen>
  );
};

const styles = StyleSheet.create({
  profileHeader: {
    alignItems: 'center',
    marginBottom: SPACING.xl,
    paddingVertical: SPACING.lg,
  },
  profilePhotoContainer: {
    position: 'relative',
    marginBottom: SPACING.md,
  },
  profilePhoto: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 3,
    borderColor: COLORS.primary,
  },
  editIconContainer: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: COLORS.surface,
    borderRadius: 15,
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.background,
  },
  profileName: {
    fontSize: FONT_SIZES.xxl,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: SPACING.xs,
  },
  addressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
  },
  profileAddress: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textSecondary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    flex: 1,
    marginRight: SPACING.sm,
  },
  section: {
    marginBottom: SPACING.xl,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.sm,
  },
  rowFlat: {
    backgroundColor: 'transparent',
    borderRadius: 0,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
    marginHorizontal: SPACING.sm,
  },
  qrCodeCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    ...SHADOWS.md,
  },
  qrCodeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  qrCodeHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  qrCodeIcon: {
    marginRight: SPACING.sm,
  },
  qrCodeTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '600',
    color: COLORS.text,
  },
  qrCodeContent: {
    alignItems: 'center',
    marginTop: SPACING.lg,
  },
  shareableQRCard: {
    backgroundColor: '#ffffff',
    padding: SPACING.xl,
    borderRadius: BORDER_RADIUS.lg,
    alignItems: 'center',
    width: 320,
  },
  shareCardProfile: {
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  shareCardProfilePhoto: {
    width: 70,
    height: 70,
    borderRadius: 35,
    borderWidth: 2,
    borderColor: COLORS.primary,
    marginBottom: SPACING.sm,
  },
  shareCardName: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: SPACING.xs,
  },
  shareCardAddress: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textSecondary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  shareCardFooter: {
    marginTop: SPACING.lg,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  shareCardFooterText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  qrCodeWrapper: {
    padding: SPACING.lg,
    backgroundColor: '#ffffff',
    borderRadius: BORDER_RADIUS.md,
    ...SHADOWS.md,
  },
  qrCodeDescription: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: SPACING.md,
    marginBottom: SPACING.md,
  },
  qrActionButtons: {
    flexDirection: 'row',
    gap: SPACING.sm,
    width: '100%',
    paddingHorizontal: SPACING.md,
  },
  qrActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: SPACING.xs,
    ...SHADOWS.sm,
  },
  qrShareButton: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  qrActionButtonText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
    color: COLORS.text,
  },
  shareButtonText: {
    color: COLORS.textInverse,
  },
  signOutSection: {
    marginBottom: SPACING.xl,
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.error + '15',
    borderWidth: 1,
    borderColor: COLORS.error,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.sm,
  },
  signOutButtonIcon: {
    marginRight: SPACING.sm,
  },
  signOutButtonText: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: COLORS.error,
  },
  signOutHint: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.textSecondary,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  footer: {
    alignItems: 'center',
    marginTop: SPACING.xl,
    paddingTop: SPACING.xl,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  footerText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
  },
  footerSubtext: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.textSecondary,
  },
});
