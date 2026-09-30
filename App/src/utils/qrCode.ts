import { Logger } from './logger';
import { getNetworkConfig, isValidAccountId } from '../services/blockchain';

// ---------------------------------------------------------------------------
// v2 payload (legacy – generated on-device, unsigned)
// ---------------------------------------------------------------------------

export interface PaymentQRData {
  type: 'cryptopay';
  version: 2;
  network: string;
  merchant: string;
  merchantId?: string;
  assetCode: string;
  assetIssuer: string;
  amount: string;
  name: string; // Merchant/recipient name
  note?: string; // Optional payment note
}

// ---------------------------------------------------------------------------
// v3 payload (signed – issued and verifiable by the relayer)
// ---------------------------------------------------------------------------

/**
 * Signed QR payment request payload (version 3).
 *
 * The relayer issues this via `POST /qr/issue` and signs the canonical JSON
 * form of all fields except `sig` itself with HMAC-SHA256 using a
 * server-side QR_SIGNING_SECRET.  The app verifies any v3 payload via
 * `POST /qr/verify` before proceeding to payment.
 *
 * Amount policy:
 *  - `amount === "0"` means variable-amount: the payer chooses the amount.
 *  - Any other value is the exact amount the merchant requests.
 *
 * Replay protection:
 *  - `nonce` is a random 16-byte hex string chosen at issue time so that
 *    two QRs issued for the same merchant and amount still produce distinct
 *    signatures.
 *  - `expiresAt` is a Unix timestamp (seconds).  The relayer and the app
 *    both reject payloads where `Date.now()/1000 >= expiresAt`.
 */
export interface PaymentQRDataV3 {
  type: 'cryptopay';
  version: 3;
  requestId: string;  // UUID or hex-128 – unique per issued QR
  nonce: string;      // 32 hex chars (16 random bytes) – replay guard
  network: string;    // e.g. "stellar-testnet"
  merchantId: string; // C-Pay merchant ID
  merchant: string;   // Stellar wallet address
  assetCode: string;
  assetIssuer: string;
  /** "0" for variable-amount (payer fills in), otherwise exact amount */
  amount: string;
  name: string;
  note?: string;
  issuedAt: number;   // Unix seconds
  expiresAt: number;  // Unix seconds
  sig: string;        // HMAC-SHA256 hex over canonical payload fields
}

export type AnyQRPayload = PaymentQRData | PaymentQRDataV3;

export type QRVerificationStatus =
  | 'verified'   // v3, signature valid, not expired
  | 'unverified' // v2 legacy or could not reach relayer
  | 'expired'    // v3, past expiresAt
  | 'invalid';   // tampered or unrecognisable

export interface QRVerificationResult {
  status: QRVerificationStatus;
  /** Populated for 'verified' – echoes the verified fields from the relayer */
  payload?: PaymentQRDataV3;
  /** Human-readable reason for non-verified statuses */
  reason?: string;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * Generate a signed v3 QR payload by calling the relayer.
 * Requires a valid Supabase bearer token.
 * Falls back to generating an unsigned v2 payload when the relayer is
 * unreachable or QR signing is not configured.
 */
export async function generateSignedQRPayload(
  merchantId: string,
  amount: string,
  merchantName: string,
  merchantAddress: string,
  bearerToken: string,
  note?: string,
  ttlSeconds = 86400
): Promise<string> {
  const { relayerUrl } = getNetworkConfig();
  try {
    const response = await fetch(`${relayerUrl}/qr/issue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bearerToken}`,
      },
      body: JSON.stringify({
        merchantId,
        merchantAddress,
        amount: amount || '0',
        merchantName,
        note: note || '',
        ttlSeconds,
      }),
    });

    if (response.ok) {
      const payload = await response.json();
      return JSON.stringify(payload);
    }
  } catch {
    // Relayer unreachable – fall through to v2
  }

  // Fallback: generate unsigned v2 payload
  return generatePaymentQRWithId(merchantId, amount, merchantName, merchantAddress, note);
}

/**
 * Request the relayer to verify a v3 QR payload.
 * Returns the verification result including status and human-readable reason.
 */
export async function verifyQRPayloadWithRelayer(
  payload: PaymentQRDataV3,
  bearerToken?: string
): Promise<QRVerificationResult> {
  const { relayerUrl } = getNetworkConfig();
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (bearerToken) headers['Authorization'] = `Bearer ${bearerToken}`;

    const response = await fetch(`${relayerUrl}/qr/verify`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    const body = await response.json();

    if (response.ok && body.valid) {
      return { status: 'verified', payload };
    }

    if (body.code === 'QR_EXPIRED') {
      return { status: 'expired', reason: 'This QR code has expired. Ask the merchant to generate a new one.' };
    }

    if (body.code === 'QR_REPLAYED') {
      return { status: 'invalid', reason: 'This QR code has already been used.' };
    }

    return { status: 'invalid', reason: body.error || 'QR verification failed' };
  } catch {
    // Cannot reach the relayer – treat as unverified but not explicitly invalid
    return { status: 'unverified', reason: 'Could not reach C-Pay servers to verify this QR code.' };
  }
}

/**
 * Generate QR code data for payment request.
 * Uses merchant ID plus Stellar account for a smooth user flow.
 */
export function generatePaymentQRWithId(
  merchantId: string,
  amount: string,
  merchantName: string,
  merchantAddress: string,
  note?: string
): string {
  const network = getNetworkConfig();
  const qrData: PaymentQRData = {
    type: 'cryptopay',
    version: 2,
    network: `stellar-${network.network}`,
    merchantId,
    merchant: merchantAddress,
    assetCode: network.assetCode,
    assetIssuer: network.assetIssuer,
    amount: amount,
    name: merchantName,
    note: note,
  };
  return JSON.stringify(qrData);
}

/**
 * Generate QR code data for payment request.
 */
export function generatePaymentQR(
  merchantAddress: string,
  amount: string,
  merchantName: string,
  note?: string
): string {
  const network = getNetworkConfig();
  const qrData: PaymentQRData = {
    type: 'cryptopay',
    version: 2,
    network: `stellar-${network.network}`,
    merchant: merchantAddress,
    assetCode: network.assetCode,
    assetIssuer: network.assetIssuer,
    amount: amount,
    name: merchantName,
    note: note,
  };
  return JSON.stringify(qrData);
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/**
 * Parse scanned QR code data.
 * Only handles v2 (legacy unsigned) payloads.
 * Use `parseAnyPaymentQR` to handle both v2 and v3.
 */
export function parsePaymentQR(qrString: string): PaymentQRData | null {
  try {
    const data = JSON.parse(qrString);

    // Validate required fields
    if (
      data.type === 'cryptopay' &&
      data.version === 2 &&
      data.merchant &&
      data.amount !== undefined &&
      data.name &&
      data.assetCode &&
      data.assetIssuer
    ) {
      return data as PaymentQRData;
    }

    return null;
  } catch (error) {
    Logger.error('Invalid QR code format:', error);
    return null;
  }
}

/**
 * Parse any C-Pay QR code (v2 or v3).
 * Returns `null` when the string is not a recognised payload.
 */
export function parseAnyPaymentQR(qrString: string): AnyQRPayload | null {
  try {
    const data = JSON.parse(qrString);
    if (data?.type !== 'cryptopay') return null;

    if (data.version === 3) {
      const v3 = data as PaymentQRDataV3;
      if (
        v3.requestId &&
        v3.nonce &&
        v3.network &&
        v3.merchantId &&
        v3.merchant &&
        v3.assetCode &&
        v3.assetIssuer &&
        v3.amount !== undefined &&
        v3.name &&
        typeof v3.issuedAt === 'number' &&
        typeof v3.expiresAt === 'number' &&
        v3.sig
      ) {
        return v3;
      }
      return null;
    }

    // Fall back to v2
    return parsePaymentQR(qrString);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

/**
 * Validate v2 payment QR data (structure + network checks only, no signature).
 */
export function validatePaymentQR(data: PaymentQRData): {
  valid: boolean;
  error?: string;
} {
  const network = getNetworkConfig();

  if (!data.merchant || !isValidAccountId(data.merchant)) {
    return { valid: false, error: 'Invalid merchant account' };
  }

  if (data.network !== `stellar-${network.network}`) {
    return { valid: false, error: 'Payment QR is for a different Stellar network' };
  }

  if (data.assetCode !== network.assetCode || data.assetIssuer !== network.assetIssuer) {
    return { valid: false, error: 'Unsupported payment asset' };
  }

  // Validate amount - allow '0' for variable amount merchant QR codes
  const amount = parseFloat(data.amount);
  if (isNaN(amount) || amount < 0) {
    return { valid: false, error: 'Invalid amount' };
  }

  // Validate name
  if (!data.name || data.name.trim().length === 0) {
    return { valid: false, error: 'Merchant name required' };
  }

  return { valid: true };
}

/**
 * Validate a v3 payload structure and check client-side expiry.
 * This does NOT verify the HMAC signature – use `verifyQRPayloadWithRelayer`
 * for tamper-evident verification.
 */
export function validatePaymentQRV3(data: PaymentQRDataV3): {
  valid: boolean;
  error?: string;
} {
  const network = getNetworkConfig();

  if (!data.merchant || !isValidAccountId(data.merchant)) {
    return { valid: false, error: 'Invalid merchant account' };
  }

  if (data.network !== `stellar-${network.network}`) {
    return { valid: false, error: 'Payment QR is for a different Stellar network' };
  }

  if (data.assetCode !== network.assetCode || data.assetIssuer !== network.assetIssuer) {
    return { valid: false, error: 'Unsupported payment asset' };
  }

  const amount = parseFloat(data.amount);
  if (isNaN(amount) || amount < 0) {
    return { valid: false, error: 'Invalid amount' };
  }

  if (!data.name || data.name.trim().length === 0) {
    return { valid: false, error: 'Merchant name required' };
  }

  if (!data.requestId || !data.nonce || !data.sig) {
    return { valid: false, error: 'QR payload is missing tamper-evident fields' };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (data.expiresAt <= nowSeconds) {
    return { valid: false, error: 'This QR code has expired' };
  }

  return { valid: true };
}
