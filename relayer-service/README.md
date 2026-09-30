# C-Pay relayer

Backend service that sponsors Stellar account setup, submits fee-bump payments, and runs the Horizon ledger ingest worker.

## Required configuration

```env
STELLAR_NETWORK=testnet
SPONSOR_SECRET_KEY=S...
DISTRIBUTION_SECRET_KEY=S...
USDC_ASSET_ISSUER=GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
```

`USDC_ASSET_ISSUER` must match Circle's canonical issuer for the selected network. C-Pay has no asset-issuer key and cannot mint USDC. The distribution account must establish a USDC trustline and obtain testnet USDC from Circle's faucet.

- `STELLAR_NETWORK`: `testnet` or `public`
- `STELLAR_HORIZON_URL`: Horizon endpoint
- `STELLAR_NETWORK_PASSPHRASE`: network passphrase
- `CPINR_ASSET_CODE`: `CPINR`
- `CPINR_ASSET_ISSUER`: issuer public key from blockchain setup
- `SPONSOR_SECRET`: secret seed for the account that sponsors reserves and pays fees
- `DISTRIBUTION_SECRET`: secret seed for the hot distribution account
- `RELAYER_AUTH_REQUIRED`: set to `true` for production/public-network deployments
- `SUPABASE_JWT_SECRET`: optional legacy HS256 token verification; when omitted, the Supabase Auth API validates tokens
- `SUPABASE_URL`: required with `SUPABASE_SERVICE_ROLE_KEY` whenever `RELAYER_AUTH_REQUIRED=true`
- `SUPABASE_SERVICE_ROLE_KEY`: required with `SUPABASE_URL` whenever `RELAYER_AUTH_REQUIRED=true`
- `ENABLE_TESTNET_FAUCET`: legacy testnet-only escape hatch; defaults to `false` and is ignored on the public network
- `LEDGER_INGEST_ENABLED`: `true` to enable background Horizon payment operation ingestion
- `INGEST_POLL_INTERVAL_MS`: poll interval in ms (default: `5000`)
- `INGEST_PENDING_TIMEOUT_MS`: timeout after which unconfirmed pending transactions are marked failed (default: `300000`)

Keep issuer secrets offline. The relayer needs sponsor and capped distribution secrets for Stellar payments.
With authentication enabled, startup also probes `wallet_bindings` and exits before
listening if the table is missing or unreachable. Supabase-free development is
available only with `RELAYER_AUTH_REQUIRED=false`.

Add Money always requires Supabase persistence, including in auth-disabled testnet
development. The relayer acquires a database lock and persists the cooldown claim
before submitting the Stellar payment; database lookup or write failures return a
retryable `503` and do not submit funds.

## Endpoints

- `GET /health`
- `GET /ingest/health`
- `GET /account/:accountId/status`
- `GET /account/:accountId/balance`
- `POST /accounts/prepare`
- `POST /accounts/submit`
- `POST /payments/submit`
- `POST /add-money`
- `GET /tx/:hash`

## Ledger Ingest Worker

The Ingest Worker continuously streams/polls Horizon payment operations:
1. **Resumable Ingestion**: Uses a cursor persisted in Supabase `ingest_state` table to resume without scanning from genesis.
2. **Idempotency**: Upserts into `transactions` with key `(tx_hash, op_index)`. Replaying the same ledger range causes no duplicates.
3. **Reconciliation**: Matches chain records against optimistic pending transactions and marks timed-out pending rows as failed.
4. **Lag Metrics**: Calculates and exposes ledger lag (`latestNetworkLedger - lastIngestedLedger`) via `GET /ingest/health` and `GET /health`.

## Production Notes

- Put the relayer behind HTTPS.
- Restrict `CORS_ORIGIN` to app domains/builds.
- Enable `RELAYER_AUTH_REQUIRED=true` and configure Supabase token verification so only authenticated app users can spend sponsored relayer resources.
- Leave `ENABLE_TESTNET_FAUCET=false`. Production money-in requires a licensed on-ramp partner.
- Rotate `SPONSOR_SECRET` and `DISTRIBUTION_SECRET` through infrastructure secrets.
- Keep `ADD_MONEY_AMOUNT`, `MAX_PAYMENT_AMOUNT`, and `ADD_MONEY_COOLDOWN_MS` policy controlled.
- Configure `ALERT_WEBHOOK_URL` for low XLM or low CPINR inventory alerts.
