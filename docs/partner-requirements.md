# Licensed INR payout partner requirements

**Status:** research and design input only  
**Research snapshot:** 27 September 2026  
**Scope:** INR bank-account and UPI payout capability for C-Pay v1

This document describes questions and requirements for selecting a regulated partner for the INR leg. It is not legal, tax, regulatory, or financial advice. C-Pay must obtain written advice from qualified counsel and written product approval from the selected partner before enabling production payouts.

## Executive summary

C-Pay should remain a software and ledger-orchestration layer. In v1 it should not custody INR, issue fiat or payment instruments, perform currency exchange as principal, or represent itself as the regulated payment provider. A regulated partner should contract with the customer for the regulated payment service, perform the applicable KYC/AML and sanctions controls, hold or settle fiat, determine the permitted route and purpose code, and own the final payout outcome.

The initial diligence shortlist is:

| Candidate | Why it is worth diligence | Important qualification |
| --- | --- | --- |
| Cashfree Payments | Cashfree publicly describes itself as an RBI-licensed PA-CB for export and import activity and publishes cross-border payment products. Its India-native compliance and bank/UPI context may fit the INR leg. | Confirm in writing that the proposed C-Pay use case, direction of funds, customer type, assets-to-fiat flow, and payout route are permitted. The public material does not establish C-Pay's eligibility, fees, minimum volumes, or settlement terms. |
| Nium | Nium publishes payout APIs, beneficiary management, batch payouts, webhooks, and India routes including bank account and UPI proxy. | Confirm India corridor availability, licensing responsibility, supported purpose codes, prefunding, settlement currency, commercial minimums, and whether the use case is accepted after KYB. |
| Wise Platform | Wise publishes an API for quotes, recipients, transfers, tracking, webhooks, and reconciliation-oriented account data. Wise also publishes India-specific purpose-code requirements. | Do not assume the Wise Platform product supports this exact flow. Obtain partner approval for the sender, recipient, source of funds, asset conversion, and INR payout model. |

No candidate is a recommendation or approval. The shortlist is a starting point for regulated-product diligence; commercial details must be obtained directly from each provider.

## 1. Regulatory and licence categories to validate

The correct category depends on the complete flow, not merely on the fact that the recipient receives INR. Counsel should classify the source of funds, who converts the funds, whether the transaction is an import/export payment or a personal remittance, where the customer and beneficiary are resident, and which entity contracts with each party.

### Authorised Dealer Category-I bank

An AD Category-I bank is authorised to handle transactions connected with permissible current- and capital-account transactions under the foreign-exchange framework. A bank may be the regulated payout and settlement partner, subject to its own product, risk, and onboarding approval.

### Authorised Dealer Category-II / FFMC

AD Category-II entities and full-fledged money changers may undertake the activities permitted by their authorisation, including specified non-trade current-account transactions and money-changing activity. They must not be treated as interchangeable with an AD Category-I bank. The partner's exact licence and the proposed flow must be checked by counsel.

### Payment Aggregator–Cross Border (PA-CB)

RBI's PA-CB framework covers entities facilitating cross-border payment transactions for permissible import or export goods and services. Non-bank entities require RBI authorisation and must satisfy the applicable regulatory and FIU-IND requirements. Whether a partner can support a particular payout leg depends on the direction and purpose of the transaction; a PA-CB label alone is not approval for every INR payout use case.

### Money Transfer Service Scheme (MTSS)

MTSS is a distinct framework for personal remittances. RBI's FAQ describes restrictions including the permitted Indian agent categories and a per-transfer limit for individual remittances. It is not a general-purpose route for merchant, treasury, or crypto-related settlement. Do not select MTSS unless counsel confirms that the actual product is a permitted personal-remittance use case.

### Practical boundary for C-Pay

C-Pay should not hold itself out as an AD, FFMC, PA-CB, or MTSS Indian agent unless the relevant entity is separately authorised and the product is approved. The selected partner should remain responsible for regulated money movement, customer/beneficiary verification, sanctions screening, transaction monitoring, FX, settlement, and regulatory reporting within the agreed operating model.

## 2. Candidate diligence

For each candidate, request a written answer rather than relying on marketing copy.

### Cashfree Payments

Cashfree's published material states that it has an RBI PA-CB (Export and Import) licence and offers cross-border payment infrastructure. Confirm:

* whether the proposed INR payout is an allowed export/import collection or another permitted product;
* whether C-Pay may be an integration/customer of record or only a technical service provider;
* whether bank-account and UPI payouts are available for the relevant beneficiary class;
* who owns KYC/KYB, AML, sanctions, transaction monitoring, purpose-code collection, and reporting;
* onboarding requirements, transaction limits, fee and FX schedule, reserve/prefunding requirements, settlement account and currency, payout SLA, and reversal process; and
* access to a sandbox, signed webhooks, payout status APIs, and daily reconciliation files.

### Nium

Nium's developer documentation describes a payout API with beneficiary management, batch payouts, status webhooks, and India payout routes such as bank account and INR UPI proxy. Confirm:

* the licensed Nium entity and its responsibility in the relevant corridor;
* whether the source-of-funds and asset-conversion model is accepted;
* whether the beneficiary is permitted to receive the proposed payment and which purpose code/evidence is required;
* KYB/KYC, sanctions, limits, prefunding, reserve, fees, FX, settlement, refund, and chargeback terms; and
* whether the API supports idempotency, signed webhooks, status history, statements, and exportable reconciliation at the required scale.

### Wise Platform

Wise's API documentation describes quote creation, recipient details, transfers, tracking, webhooks, and account information. Its India guidance states that INR transfers require a purpose code and that an incorrect code can delay or reject a transfer. Confirm:

* whether Wise Platform will approve this business model and all source/destination jurisdictions;
* who supplies and validates the purpose code and supporting evidence;
* whether the payout is permitted for the beneficiary type, transaction purpose, and source of funds;
* account ownership, KYB, API scopes, limits, fees, FX, prefunding, settlement and statement access; and
* the exact webhook, refund, reversal, compliance-review, and reconciliation behaviour.

## 3. Integration surface

The ledger service should expose a provider-neutral contract. Provider-specific credentials, status codes, and payloads belong in an adapter; raw bank or UPI credentials must never enter the ledger or application logs.

### Payout instruction

The request should contain at least:

* an immutable C-Pay payout ID and an idempotency key;
* ledger entry and customer/account references;
* selected provider and quote/reference ID;
* source and destination currencies and amounts in integer minor units;
* tokenised beneficiary reference (bank account or UPI details must be stored only where the regulated partner requires them);
* sender and beneficiary KYC/KYB references, residency, and purpose-code data where required;
* callback correlation data and a versioned metadata object; and
* an explicit consent and audit reference.

The adapter response should record the provider payout ID, accepted/pending status, quoted FX and fees, timestamps, and any provider review or evidence requirement. It must not mark a payout as final merely because an instruction was accepted.

### Status webhooks

Webhooks must be authenticated and replay-safe. Store the provider event ID, provider payout ID, received time, signature-verification result, and the mapped C-Pay state. Process each event idempotently and retain the raw event in restricted audit storage only as long as the retention policy permits.

At minimum map provider events to `accepted`, `pending`, `compliance_review`, `paid`, `failed`, `refunded`, and `reversed`. Unknown provider states must be retained and surfaced for review; they must not silently become `paid`.

### Reconciliation file

Require a daily or agreed-period file containing payout ID, ledger ID, provider reference, value and settlement dates, gross amount, fee, FX rate, net amount, source and destination currencies, final status, refund/reversal reason, and settlement batch/reference. Reconciliation should be a separate process from webhook handling and should identify missing, duplicated, amount-mismatched, and late records.

### Refund and reversal

The adapter must expose whether cancellation is possible before settlement and must preserve the provider's reason and reference for every return. C-Pay should use a state transition such as `paid -> reversal_pending -> reversed` or `pending -> refund_pending -> refunded`; it must never silently overwrite a settled ledger entry. Any customer compensation, FX difference, fee treatment, and failed-return escalation must be specified in the partner agreement.

### Security and operations

Use a secret manager, least-privilege partner credentials, environment separation, encrypted transport, redacted structured logs, request signing, webhook signature verification, replay protection, rate limits, and an auditable operator action trail. Define timeout, retry, circuit-breaker, manual-review, incident, and business-continuity procedures before production launch.

## 4. Partner due-diligence checklist

Obtain and retain evidence for:

1. The regulated entity name, jurisdiction, licence/authorisation number, permitted product and corridor, and regulator lookup link.
2. A written statement that the proposed C-Pay flow is permitted, including the source of funds, conversion point, beneficiary type, purpose code, and direction of payment.
3. KYB/KYC, AML, sanctions, transaction-monitoring, suspicious-activity escalation, and record-retention responsibilities.
4. Customer terms, data-processing terms, sub-processors, data location, breach notification, audit rights, and deletion/retention policy.
5. Account ownership, segregation/custody, prefunding, reserve, settlement frequency, settlement currency, fees, FX, tax documents, and reconciliation format.
6. Transaction and beneficiary limits, volume minimums, rate limits, payout SLAs, compliance-review handling, and support escalation.
7. Sandbox credentials, test cases for success/pending/failure/review/refund/reversal, signed webhook examples, idempotency behaviour, and reconciliation samples.
8. Contract termination, data export, outstanding-payout handling, business continuity, and provider insolvency/operational-failure procedures.

Do not fill unknown commercial values with assumptions. Record them as open diligence items and obtain them from the partner.

## 5. What C-Pay must not do in v1

Unless and until counsel confirms a different authorised model, C-Pay must not:

* receive, pool, custody, or hold INR or customer fiat;
* issue INR balances, stored value, payment instruments, or a customer wallet denominated in INR;
* promise an exchange rate, payout completion, or settlement time as principal;
* perform FX or payment aggregation in its own name;
* choose or override a purpose code, bypass partner screening, or split transactions to evade limits;
* store raw bank-account, UPI, identity, or payment credentials outside the approved regulated-partner boundary;
* mark a ledger payout as final before the partner confirms final settlement; or
* market the software as a bank, AD, FFMC, PA-CB, remittance provider, or custodian.

## 6. Open questions for legal and compliance review

1. Is the actual use case a permitted import/export payment, a personal remittance, a merchant payout, or another category?
2. Where are the sender, beneficiary, C-Pay entity, partner entity, and any asset-conversion service resident?
3. Who owns the customer relationship and contracts for the regulated payment service?
4. At what point, and by which regulated entity, are digital assets or other source funds converted to fiat?
5. Does any C-Pay component control or possess fiat, customer funds, private keys, or payout credentials?
6. Who performs KYC/KYB, sanctions screening, transaction monitoring, purpose-code validation, tax reporting, and suspicious-activity escalation?
7. What evidence is required for each payout purpose, and who retains it?
8. Do GST, withholding/TCS, tax-residency, invoice, FIRC/e-FIRC, or other reporting obligations apply?
9. What currencies, corridors, beneficiary types, limits, and expected monthly volumes are in scope?
10. What happens during partner compliance review, timeout, refund, reversal, bank rejection, or provider outage?
11. What privacy, cross-border transfer, retention, deletion, and data-subprocessor requirements apply?
12. What customer disclosures and consent are required before a payout instruction is submitted?

## 7. Recommended next step

Run parallel diligence with Cashfree, Nium, and Wise Platform. Give each provider the same redacted flow diagram and the open-question list, and request written eligibility, licence/entity details, operating responsibilities, API/webhook/reconciliation samples, and commercial terms. Select a partner only after counsel confirms the regulatory classification and the partner confirms the exact product in writing. Keep the production payout feature disabled until those approvals and the integration-state tests are complete.

## Sources

The following primary or provider documentation was reviewed for this research snapshot:

* [RBI: Guidelines on Regulation of Payment Aggregators and Payment Gateways](https://rbi.org.in/Scripts/NotificationUser.aspx/upload/Scripts/NotificationUser.aspx?Id=12561) — PA-CB scope and authorisation requirements.
* [RBI: Master Direction – Money Changing Activities](https://rbi.org.in/scripts/BS_ViewMasDirections.aspx?id=11518) — authorised-dealer and money-changing categories.
* [RBI: Foreign Exchange Management Act FAQ](https://www.rbi.org.in/Scripts/FAQDisplay.aspx?Id=146) — use of authorised persons for foreign exchange.
* [RBI: Money Transfer Service Scheme FAQ](https://www.rbi.org.in/scriptS/FAQView.aspx?Id=112) — personal-remittance scope and limits.
* [Cashfree: International payment gateway](https://www.cashfree.com/international-payment-gateway/) and [cross-border payment solutions](https://www.cashfree.com/cross-border-payment-solutions/) — published product and licence claims.
* [Nium developer documentation](https://www.nium.com/developers), [India payout routes](https://icc.nium.com/country/india), and [licences](https://www.nium.com/licenses) — API, route, and regulatory materials.
* [Wise Platform payout use cases](https://docs.wise.com/guides/product/send-money/use-cases/payouts-smbs), [developer guide](https://docs.wise.com/guides/developer), and [INR purpose codes](https://wise.com/help/articles/6hAFdOM3eAYMyvnOQ0c1g/inr-purpose-codes) — API and India-specific operational requirements.
