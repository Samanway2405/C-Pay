# Pilot migration: legacy CPINR to Circle USDC

C-Pay now uses Circle-issued USDC on Stellar. The app does not issue a currency.

## Existing pilot users

- Existing CPINR is a testnet-only token with no monetary value.
- No CPINR is converted, redeemed, burned, or silently deleted. The old balance
  remains on its original Stellar trustline and is simply no longer displayed
  or accepted by C-Pay.
- On next wallet preparation, the existing Stellar account receives a sponsored
  trustline to Circle's testnet USDC issuer.
- Historical transaction rows keep their original asset identity. Database
  defaults change only for new USDC records.
- Testnet USDC for operator testing must come from the Circle Faucet; C-Pay has
  no issuer secret and no minting path.

## Product decisions

- Display currency: USDC, with `$` and `USDC` both shown where context matters.
- Precision: signed amounts accept at most seven decimal places. Displays show
  at least two decimals and up to seven meaningful decimals. An eighth decimal
  is rejected for payments; display-only values round to seven decimals.
- FX: the app shows no INR equivalent and no invented fixed rate. INR quotes,
  spread, fees, and expiry belong to a future licensed on-ramp/off-ramp partner.
- Money-in: the current distribution endpoint is testnet-only and must stay off
  on the public network. The real replacement is a licensed partner flow, not a
  C-Pay-issued asset or faucet.
