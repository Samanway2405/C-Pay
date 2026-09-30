# C-Pay Stellar rail

This package contains the Stellar transaction helpers and operator setup for
Circle-issued USDC. C-Pay does not issue, mint, administer, or claim to back a
currency.

## Canonical asset

| Network | Code | Circle issuer |
| --- | --- | --- |
| Testnet | `USDC` | `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` |
| Public | `USDC` | `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` |

The code rejects any different issuer for these networks. The testnet issuer is
documented by Stellar and test tokens come from the
[Circle Faucet](https://faucet.circle.com/); they have no monetary value.

## Operator accounts

- `SPONSOR_SECRET` pays account reserves and fee bumps.
- `DISTRIBUTION_SECRET` controls only USDC already held by the distribution
  account. It has no ability to issue USDC.

Generate development accounts with:

```bash
npm run create:keypairs
```

Configure a distribution trustline:

```text
STELLAR_NETWORK=testnet
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
USDC_ASSET_ISSUER=GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
DISTRIBUTION_PUBLIC_KEY=<distribution public key>
DISTRIBUTION_SECRET=<distribution secret>
TRUSTLINE_LIMIT=1000000000
```

```bash
npm run setup:usdc
```

The setup command creates or verifies the Circle USDC trustline. It never issues
an asset. On testnet, fund the distribution address separately through Circle's
faucet. On the public network, funding must come from an approved provider flow.

## Library flow

1. Create or load the user Stellar account.
2. Add a trustline to the canonical Circle USDC asset.
3. Sign USDC payments locally with the user's key.
4. Optionally wrap signed payments in a sponsored fee-bump transaction.

Amounts are valid to seven decimal places, matching Stellar's stroop precision.
