import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SplashScreen } from '../screens/SplashScreen';
import { OnboardingScreen } from '../screens/OnboardingScreen';
import { EmailVerificationScreen } from '../screens/EmailVerificationScreen';
import { CreatePINScreen } from '../screens/CreatePINScreen';
import { ConfirmPINScreen } from '../screens/ConfirmPINScreen';
import { ChangePINScreen } from '../screens/ChangePINScreen';
import { ForgotPINScreen } from '../screens/ForgotPINScreen';
import { BiometricSetupScreen } from '../screens/BiometricSetupScreen';
import { CloudBackupSetupScreen } from '../screens/CloudBackupSetupScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { RestoreWalletScreen } from '../screens/RestoreWalletScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { ScanScreen } from '../screens/ScanScreen';
import { QRGeneratorScreen } from '../screens/QRGeneratorScreen';
import { TransactionHistoryScreen } from '../screens/TransactionHistoryScreen';
import { SendMoneyScreen } from '../screens/SendMoneyScreen';
import { ProfileSetupScreen } from '../screens/ProfileSetupScreen';
import { PaymentProcessingScreen } from '../screens/PaymentProcessingScreen';
import { PaymentSuccessScreen } from '../screens/PaymentSuccessScreen';
import { PaymentFailureScreen } from '../screens/PaymentFailureScreen';
import { SecurityCenterScreen } from '../screens/SecurityCenterScreen';
import { InfoScreen, type InfoDoc } from '../screens/InfoScreen';
import { COLORS, SPACING, createThemedStyles, useTheme } from '../constants/theme';

type RootStackParamList = {
  Splash: undefined;
  Onboarding: undefined;
  EmailVerification: undefined;
  CreatePIN: { phoneNumber: string };
  ConfirmPIN: { pin: string; phoneNumber: string };
  ProfileSetup: { walletAddress: string; phoneNumber: string };
  ChangePIN: undefined;
  ForgotPIN: undefined;
  CloudBackupSetup: { fromSettings?: boolean } | undefined;
  BiometricSetup: { flowType?: 'setup' | 'restore' } | undefined;
  RestoreWallet: {
    verifiedEmail?: string;
    walletAddress: string;
    displayName?: string | null;
    cpayId?: string | null;
    profilePhotoUrl?: string | null;
    phoneNumber?: string | null;
  };
  Login: undefined;
  MainTabs: undefined;
  Scan: { returnTo?: string };
  SendMoney: {
    recipientAddress?: string;
    amount?: string;
    recipientName?: string;
    note?: string;
    hideBalance?: boolean;
    isFromQR?: boolean;
    idempotencyKey?: string;
  };
  PaymentProcessing: { amount: string; recipientName: string; recipientAddress: string };
  PaymentSuccess: { transactionHash: string; fromAddress: string; amount: string; recipientName: string; recipientAddress: string; processingTime?: number; timestamp?: string; note?: string };
  PaymentFailure: { amount: string; recipientName: string; recipientAddress: string; errorMessage?: string; errorReason?: string; errorCode?: string; category?: 'retryable' | 'support'; timestamp?: string; note?: string; idempotencyKey?: string };
  QRGenerator: undefined;
  TransactionHistory: { highlightTransaction?: string };
  SecurityCenter: undefined;
  Info: { doc: InfoDoc };
};

type MainTabsParamList = {
  Home: undefined;
  ScanPlaceholder: undefined;
  Profile: undefined;
};

const Stack = createStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabsParamList>();

const linking = {
  prefixes: ['cpay://', 'https://cpay.app'],
  config: {
    screens: {
      MerchantRegistration: 'MainTabs',
      MerchantDashboard: 'MainTabs',
      MerchantQRGenerator: 'MainTabs',
      MerchantGlobalQR: 'MainTabs',
      MerchantTransactions: 'MainTabs',
    },
  },
};

const TAB_BAR_CONTENT_HEIGHT = 56;
const MIN_TAB_BAR_BOTTOM_PADDING = SPACING.sm;

const MainTabs = () => {
  const insets = useSafeAreaInsets();
  const bottomPadding = Math.max(insets.bottom, MIN_TAB_BAR_BOTTOM_PADDING);
  const tabBarHeight = TAB_BAR_CONTENT_HEIGHT + bottomPadding;

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: true,
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.textTertiary,
        tabBarHideOnKeyboard: true,
        tabBarStyle: {
          borderTopWidth: 1,
          borderTopColor: COLORS.borderLight,
          paddingTop: SPACING.xs,
          paddingBottom: bottomPadding,
          height: tabBarHeight,
          backgroundColor: COLORS.surface,
        },
        tabBarItemStyle: styles.tabBarItem,
        tabBarLabelStyle: styles.tabBarLabel,
        tabBarShowLabel: route.name !== 'ScanPlaceholder',
      })}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          tabBarLabel: 'Home',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'home' : 'home-outline'} size={22} color={color} />
          ),
          headerTitle: 'C-Pay',
        }}
      />
      <Tab.Screen
        name="ScanPlaceholder"
        component={View}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            e.preventDefault();
            const parent = navigation.getParent();
            if (parent) {
              parent.navigate('Scan' as never);
            }
          },
        })}
        options={{
          tabBarLabel: '',
          tabBarIcon: ({ focused }) => (
            <View style={styles.scanButton}>
              <View style={[styles.scanButtonInner, focused && styles.scanButtonFocused]}>
                <Ionicons name="scan" size={26} color={COLORS.textInverse} />
              </View>
            </View>
          ),
          headerShown: false,
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          tabBarLabel: 'Profile',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'person' : 'person-outline'} size={22} color={color} />
          ),
          headerTitle: 'Profile',
        }}
      />
    </Tab.Navigator>
  );
};

export const Navigation = () => {
  const { colors, isDark } = useTheme();
  const baseTheme = isDark ? DarkTheme : DefaultTheme;
  const navigationTheme = {
    ...baseTheme,
    colors: {
      ...baseTheme.colors,
      primary: colors.primary,
      background: colors.background,
      card: colors.surfaceElevated,
      text: colors.textPrimary,
      border: colors.border,
      notification: colors.error,
    },
  };

  return (
    <NavigationContainer linking={linking} theme={navigationTheme}>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
        }}
        initialRouteName="Splash"
      >
        <Stack.Screen name="Splash" component={SplashScreen} />
        <Stack.Screen name="Onboarding" component={OnboardingScreen} />
        <Stack.Screen name="EmailVerification" component={EmailVerificationScreen} />
        <Stack.Screen name="CreatePIN" component={CreatePINScreen} />
        <Stack.Screen name="ConfirmPIN" component={ConfirmPINScreen} />
        <Stack.Screen 
          name="ProfileSetup" 
          component={ProfileSetupScreen}
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen name="ChangePIN" component={ChangePINScreen} />
        <Stack.Screen 
          name="ForgotPIN" 
          component={ForgotPINScreen}
          options={{
            headerShown: true,
            headerTitle: 'Reset PIN',
          }}
        />
        <Stack.Screen name="CloudBackupSetup" component={CloudBackupSetupScreen} />
        <Stack.Screen name="BiometricSetup" component={BiometricSetupScreen} />
        <Stack.Screen name="RestoreWallet" component={RestoreWalletScreen} />
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="MainTabs" component={MainTabs} />
        <Stack.Screen name="Scan" component={ScanScreen} />
        <Stack.Screen 
          name="SendMoney" 
          component={SendMoneyScreen}
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="PaymentProcessing"
          component={PaymentProcessingScreen as any}
          options={{
            headerShown: false,
            gestureEnabled: false,
          }}
        />
        <Stack.Screen 
          name="PaymentSuccess" 
          component={PaymentSuccessScreen as any}
          options={{
            headerShown: false,
            gestureEnabled: false,
          }}
        />
        <Stack.Screen 
          name="PaymentFailure" 
          component={PaymentFailureScreen}
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen 
          name="QRGenerator" 
          component={QRGeneratorScreen}
          options={{
            headerShown: true,
            headerTitle: 'QR Generator (Testing)',
          }}
        />
        <Stack.Screen 
          name="TransactionHistory" 
          component={TransactionHistoryScreen}
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="SecurityCenter"
          component={SecurityCenterScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="Info"
          component={InfoScreen}
          options={{ headerShown: false }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

const styles = createThemedStyles((COLORS) => ({
  tabBarItem: {
    justifyContent: 'center',
    minWidth: 64,
  },
  tabBarLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 0,
  },
  scanButton: {
    top: -18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanButtonInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: COLORS.shadow,
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 4.65,
    elevation: 8,
  },
  scanButtonFocused: {
    backgroundColor: COLORS.primaryDark,
    transform: [{ scale: 1.1 }],
  },
}));
