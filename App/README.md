# C-Pay mobile app

React Native/Expo self-custody wallet for Stellar USDC.

## Asset configuration

The app accepts Circle-issued USDC only. Testnet defaults to Circle's canonical issuer:

```env
EXPO_PUBLIC_STELLAR_NETWORK=testnet
EXPO_PUBLIC_USDC_ASSET_ISSUER=GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
```

Amounts are signed with at most seven fractional digits. The UI displays between two and seven fractional digits and labels balances explicitly as USDC.

See [`../docs/usdc-migration.md`](../docs/usdc-migration.md) for asset and pilot-user migration decisions.
