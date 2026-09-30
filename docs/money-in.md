# Money in

C-Pay does not currently support deposits. The disabled legacy testnet faucet is not a fiat bridge and must not be presented as one.

The app should show: **Add money — coming soon, via a licensed partner.**

## What a real on-ramp requires

A production money-in flow needs a licensed banking or payment partner, customer identity and sanctions checks, source-of-funds controls, payment collection, settlement and reconciliation, refunds and chargebacks, transaction monitoring, limits, support, audit records, and an agreed failure and dispute process. Those responsibilities cannot be simulated by distributing free test tokens.

The commercial and technical design must define:

- the licensed partner and supported source countries;
- who performs KYC/AML and retains compliance records;
- quoted FX, fees, expiry, and customer disclosures;
- settlement accounts and reconciliation identifiers;
- refund, reversal, chargeback, and support ownership;
- webhook authentication, idempotency, and recovery behavior;
- production monitoring, limits, and incident response.

## Legacy faucet safety

The relayer retains a temporary migration-only testnet route for development data. It is disabled by default, requires `ENABLE_TESTNET_FAUCET=true`, and is hard-blocked unless `STELLAR_NETWORK=testnet`. No production/public-network deployment can enable it. The mobile UI has no faucet action.
