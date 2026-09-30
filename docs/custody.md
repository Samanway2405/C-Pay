# Key custody

C-Pay does not issue or custody the USDC asset. Circle controls the USDC issuer; C-Pay must never store an issuer secret or expose minting code.

## Keys operated by C-Pay

| Account | Purpose | Recommended control |
| --- | --- | --- |
| Sponsor | Creates accounts and pays sponsored reserves and fees | Isolated secret store, least-privilege service access, rotation runbook |
| Distribution | Holds testnet USDC used for pilot distribution | Separate secret store, low-balance monitoring, strict inventory limits |
| User | Signs user payments | Encrypted user-controlled wallet backup; never sent to the relayer |

Production money-in must come from a licensed on-ramp partner. The distribution account is a testnet-only pilot mechanism, not an issuer or fiat reserve.

1. **Host Compromise / Server Breach**: Exfiltration of `.env` leads to total loss of sponsor funds and distribution liquidity.
2. **Insider Threat & Operator Mistake**: Accidental logging, accidental commits, or shared credentials.
3. **Single Point of Failure (SPOF)**: Inability to rotate compromised keys without downtime.

To eliminate raw secret storage and mitigate key drainage attacks, C-Pay enforces a **tiered least-privilege key architecture** backed by **Cloud KMS / HSM** and **Stellar Multi-Signature (Multisig)**.

---

## 2. Key Inventory & Separation of Privilege (Least Privilege)

Every key in the C-Pay ecosystem has a distinct role, security tier, and authorization threshold:

| Key Role | Purpose | Storage Tier | Signer Mechanism | Multi-Sig / Threshold |
| :--- | :--- | :--- | :--- | :--- |
| **Asset Issuer (CPINR)** | Mints/Burns CPINR tokens, manages asset flags (auth_required, revoking). | **Tier 1: Cold Storage** | Ledger Nano X / AWS CloudHSM | **3-of-5 M-of-N Multisig** (Core Team Quorum) |
| **Soroban Contract Admin** | Upgrades smart contracts, pauses protocol in emergency. | **Tier 1: Cold Storage** | Hardware Security Module / Air-Gapped | **3-of-5 Multisig** |
| **Relayer Distribution** | Fulfills Add Money liquidity requests to user wallets. | **Tier 2: Warm Storage** | AWS KMS / GCP Cloud KMS (Ed25519) | **2-of-3 Multisig** (Relayer + Security Co-Signer) |
| **Relayer Sponsor** | Sponsors account creation reserves (1.5 XLM) and wraps fee bumps. | **Tier 3: Hot Signing** | AWS KMS / HashiCorp Vault | **1-of-2 with daily drain caps** |
| **Ledger Ingest Worker** | Ingests on-chain transactions into Postgres. | **Tier 4: Read-Only** | Read-Only Stellar Horizon API | **No signing privileges** |

---

## 3. Storage & Signing Architecture (Zero Plaintext Secrets)

### 3.1 Eliminating Raw Secret Keys in Deployed Environments
In all non-local deployed environments (Staging, Pre-Prod, Mainnet):
- **No `SPONSOR_SECRET` or `DISTRIBUTION_SECRET` plaintext values exist in `.env` or container filesystems.**
- Relayer processes authenticate using **IAM Instance Roles** (AWS IAM / GCP Workload Identity / Vault AppRole).
- Signing operations call the `KeyManager` interface (`relayer-service/keyManager.js`), which submits the transaction hash to KMS / HSM to receive the signature.

### 3.2 Key Management Service (KMS) Setup
- **AWS KMS Key Spec**: `ECC_NIST_ED25519` (Stellar Ed25519 Curve25519 signing).
- **Key Policy**: Restricted strictly to the Relayer Execution Role ARN (`arn:aws:iam::...:role/cpay-relayer-signer`).
- **CloudTrail Auditing**: Every `kms:Sign` request logs the transaction hash, caller identity, IP, and timestamp.

---

## 4. Stellar Multi-Signature Architecture

Stellar native accounts support weights and thresholds on low, medium, and high threshold operations:

```text
Low Threshold (1): Allow trust, bump sequence
Medium Threshold (2): Payments, sponsor reserves, manage data
High Threshold (3): Account merge, set options (adding/removing signers)
```

### 4.1 Distribution Account Multisig Policy
- **Primary Signer (Relayer KeyManager)**: Weight = 1
- **Automated Risk Engine (Co-Signer Worker)**: Weight = 1
- **Emergency Cold Key**: Weight = 2
- **Thresholds**: `Low = 1`, `Medium = 2`, `High = 3`
- *Outcome:* The relayer alone cannot drain funds to arbitrary destinations without passing the automated risk engine co-signer check (or invoking emergency cold key quorum).

### 4.2 Asset Issuer Multisig Policy
- **Signers**: 5 core team member hardware keys (weight 1 each).
- **Master Key Weight**: Set to 0 (master key disabled).
- **Thresholds**: `Low = 3`, `Medium = 3`, `High = 3`.
- *Outcome:* No individual person or compromised server can mint CPINR or alter contract state unilaterally.

---

## 5. Zero-Downtime Key Rotation Runbook

When a key reaches its rotation period (standard: 90 days) or a suspected compromise occurs, follow this tested rotation procedure.

### 5.1 Rotation Workflow Diagram

```text
1. Provision New KMS Key
       │
2. Add New Key as Signer on Stellar Account (Weight = Existing Weight)
       │
3. Update Relayer KeyManager Config (Hot Reload / Deployment)
       │
4. Verify Relayer is Signing with New Key
       │
5. Remove Old Signer from Stellar Account (Set Weight = 0)
```

### 5.2 Step-by-Step Rotation Drill (Rehearsed on Testnet)

#### Step 1: Generate & Register New Key in KMS
```bash
# Example: Provision new AWS KMS Key
aws kms create-key --key-spec ECC_NIST_ED25519 --key-usage SIGN_VERIFY --description "cpay-sponsor-v2"
# Export new public key: G_NEW_SPONSOR_KEY
```

#### Step 2: Add New Signer to Stellar Account
Submit a `setOptions` transaction from the existing account master/multisig signer:
```javascript
const tx = new StellarSdk.TransactionBuilder(account, { fee: 100, networkPassphrase })
  .addOperation(StellarSdk.Operation.setOptions({
    signer: {
      ed25519PublicKey: G_NEW_SPONSOR_KEY,
      weight: 1, // Add new signer with valid signing weight
    },
  }))
  .setTimeout(60)
  .build();

tx.sign(currentKeypair);
await server.submitTransaction(tx);
```

#### Step 3: Hot-Rotate in Relayer KeyManager
The `KeyManager` supports zero-downtime runtime rotation via `rotateKey(role, newIdentifier)`:
```javascript
// Relayer dynamically switches active signer:
keyManager.rotateKey('sponsor', 'kms://arn:aws:kms:region:account:key/cpay-sponsor-v2');
```

#### Step 4: Verify Transactions
Send a test `/accounts/prepare` request and confirm on Horizon that transactions are signed by `G_NEW_SPONSOR_KEY`.

#### Step 5: Decommission Old Signer on Stellar
Once the new key is actively signing:
```javascript
const removeOldSignerTx = new StellarSdk.TransactionBuilder(account, { fee: 100, networkPassphrase })
  .addOperation(StellarSdk.Operation.setOptions({
    signer: {
      ed25519PublicKey: G_OLD_SPONSOR_KEY,
      weight: 0, // Setting weight to 0 removes the signer completely
    },
  }))
  .setTimeout(60)
  .build();

removeOldSignerTx.sign(newKeypair);
await server.submitTransaction(removeOldSignerTx);
```

---

## 6. Testnet Rehearsal Log & Validation Results

* **Date Executed:** August 31, 2026
* **Network:** Stellar Testnet
* **Target Account:** `GBGJS2UIEF2DYN3L67P2A7X62M4WK72JGTF7ABCOQL75UYHMWYLFRI4S`
* **Test Sequence:**
  1. Set up initial keypair `K1` with weight 1.
  2. Prepared and submitted Add Money claims using `K1` (Success).
  3. Added second keypair `K2` via `setOptions` with weight 1. Both `K1` and `K2` valid.
  4. Rotated Relayer `KeyManager` active signer from `K1` to `K2`.
  5. Successfully processed `/accounts/prepare` and `/payments/submit` using `K2`.
  6. Set `K1` weight to 0.
  7. Attempted transaction signed by `K1` only -> Horizon rejected with `tx_bad_auth` (Signer successfully revoked).
  8. Transactions signed by `K2` succeeded with 0 downtime.

---

## 7. Monitoring, Alarms & Incident Response

### 7.1 Balance Alarms
- **Sponsor Account Low Balance**: Triggered when XLM balance < `LOW_XLM_THRESHOLD` (default 10 XLM).
- **Distribution Account Low Balance**: Triggered when CPINR balance < `LOW_CPINR_THRESHOLD` (default 1000 CPINR).
- **Webhook Alerts**: Dispatched immediately via `ALERT_WEBHOOK_URL` to PagerDuty / Slack.

### 7.2 Anomaly & Velocity Detection
- **Signing Velocity Threshold**: Triggered if `KeyManager` exceeds 120 signatures/minute (`MAX_SIGNS_PER_MINUTE`).
- **Unexpected Source Account Check**: Relayer enforces `requireWalletOwnership()` on every request to prevent signing for unauthorized accounts.
- **Circuit Breaker**: Keep the legacy testnet faucet disabled (`ENABLE_TESTNET_FAUCET=false`) and revoke the distribution key if unauthorized signing is detected.

---

## 8. Summary of Compliance & Acceptance Criteria

| Requirement | Implementation | Status |
| :--- | :--- | :--- |
| **Written Custody Plan** | [docs/custody.md](file:///d:/Coding/C-Pay/docs/custody.md) detailing inventory, storage, rotation, alerting | ✅ Complete |
| **No Raw Secrets in Deployed Environments** | `KeyManager` KMS/Vault provider abstraction in `relayer-service/keyManager.js` | ✅ Complete |
| **Least Privilege & Role Separation** | Strict separation between Issuer, Sponsor, and Distribution keys | ✅ Complete |
| **Multi-Signature Policy** | M-of-N multisig policies for funds and issuer controls documented | ✅ Complete |
| **Rotation Runbook & Rehearsal** | Zero-downtime rotation protocol documented and verified on testnet | ✅ Complete |
| **Balance & Activity Alarms** | Automated balance drop & velocity alert dispatching in place | ✅ Complete |
