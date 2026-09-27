# Remittance quotes

`POST /quotes` returns a sender-facing quote. The endpoint requires the same
Bearer authentication as the relayer and is rate-limited with the rest of the
service.

Request:

```json
{
  "sendAmount": "100.00",
  "sendCurrency": "USD",
  "receiveCurrency": "INR"
}
```

Response (`201`):

```json
{
  "sendAmount": "100.00",
  "amountDebited": "101.75",
  "fee": "1.75",
  "feeBps": 175,
  "fxRate": 90.12345678,
  "spreadBps": 50,
  "recipientAmount": "8967.28",
  "receiveCurrency": "INR",
  "expiresAt": "2026-09-27T12:01:00.000Z",
  "rateMovementPolicy": "The quoted recipient amount is fixed until expiresAt; settlement must reject expired quotes and obtain a new quote."
}
```

The FX provider is injected behind a small `getRate({ from, to })` interface.
The relayer's initial provider reads rates from `QUOTE_FX_RATES_JSON`, for
example `{"USD_INR":90.12345678}`. Fees and spread are configurable with
`QUOTE_FEE_BPS`, `QUOTE_SPREAD_BPS`, and `QUOTE_TTL_SECONDS`; no fallback rate
is used when a pair is missing. Monetary arithmetic uses integer minor units
and rounds the fee up so the sender is never undercharged.

Settlement must call `assertFresh` immediately before accepting a quote. An
expired quote is rejected with `QUOTE_EXPIRED` and must be replaced by a new
quote, so rate movement is absorbed by re-quoting rather than silently changing
the recipient's promised amount.

The relayer exposes this server-side check as `POST /quotes/validate` for
integrations that need to validate a quote before handing it to settlement.
Expired quotes return `410 QUOTE_EXPIRED`.
