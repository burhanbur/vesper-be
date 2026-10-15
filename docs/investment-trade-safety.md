# Investment trade safety boundary

## Current implementation

`POST /api/v1/investment-transactions` is authenticated, creates server-generated trade and optional linked cash IDs, and is **not an idempotent offline command**. Do not retry an ambiguous POST as a new trade. No endpoint contract or database schema is changed by this work.

The repository locks the instrument before ledger accounts, validates access and IDR account categories, requires a timestamp strictly later than the latest trade for the account/instrument, rejects oversells, and commits trade, linked cash, balance recomputation and snapshots in one transaction. Holdings replay active rows ordered by timestamp then ID. BUY moving average excludes fees; partial SELL retains average, full SELL resets it; DIVIDEND leaves quantity/average unchanged. These are existing business rules, not a new tax/cost policy.

Settlement uses decimal strings and 80-digit arithmetic. Gross = quantity × unit price; BUY cash = gross + fee (EXPENSE), SELL/DIVIDEND cash = gross − fee (INCOME). Round once HALF_UP to 2 places. Linked cash must remain strictly positive after rounding and fit Decimal(20,2). Investment account balance is not market value. Realized SELL P/L = quantity × (price − prior average) − fee, rounded to 2 places. The extracted settlement helper is exercised for fractions, fee direction, large exact values, zero/negative cash and overflow.

## Durable command repository boundary

`PrismaInvestmentRepository.createOffline` now accepts stable client trade and cash-ledger UUIDs for BUY/SELL with a required cash account. A transaction-scoped command-ID lock serializes retries even when their payload changes. Current instrument/account access is checked before replay. Matching active, version-1 trade and ledger rows return unchanged; semantic decimal equality is accepted. Changed payload or ledger ID conflicts. Sync now accepts CREATE `investment_transactions` commands through this repository boundary. The regular online POST remains unchanged. Mobile writes remain disabled until exact local projection and reconciliation are implemented.

Real isolated PostgreSQL regression tests cover concurrent identical commands, equivalent decimal replay, changed payload/ledger IDs, revoked cash access, and ledger-ID collision rollback alongside settlement and transfer tests. No existing development database is reset.

## Offline command contract

- Use a push-only CREATE `investment_transactions` command with client_version `0`. Allocate one client UUID for entity_id/trade ID and one distinct UUID for the linked cash transaction before local commit; persist and resend unchanged. Require a cash account for this mobile command; do not silently create cashless trades.
- Carry instrument_id, investment account_id, cash_account_id, linked_transaction_id, BUY/SELL type, quantity/price (up to 8 decimals), fee (up to 2), millisecond UTC timestamp, and normalized nullable description. Do not introduce DIVIDEND offline until its quantity/gross semantics are explicitly approved.
- Replay must run under the same instrument/account locks and check an existing trade **before chronology/oversell validation**. Require actor ownership, IDs, account/instrument/type, exact decimal numerical equality, timestamp, normalized description, version and active status to match. Verify the linked cash row's ID, actor, account, type, amount, date, description, lack of category/transfer and exclusive linkage. Return the existing result without any new writes. Mismatch or tombstone is a non-disclosing conflict, not a new trade.
- A new command must atomically write trade, linked cash, balances, snapshots and publication. Global unique IDs arbitrate races. Never acknowledge before commit or rely on retained sync events for deduplication.
- Local SQLite must atomically persist command, position/cash projections and stable IDs using exact fixed-point/decimal arithmetic. Invalid/rejected commands remain visible for review; do not auto-regenerate IDs, timestamps, or rebase a SELL against changed holdings. Verify rollback on storage failure and restart replay.

## Why writes remain disabled on mobile

The additive `20261015000000_add_investment_sync` migration permits investment events and backfills historical trades and formerly hidden settlement cash for current account audiences. Deploy with writers stopped before the new application. Publication now includes trades and cash rows, with grant/revocation and account tombstone events. Pull authorizes each row by its own account; sharing an investment account does not grant access to its cash account. An account balance pull alone cannot reconcile pending trade quantity, cost basis and cash. Portfolio reads are account-scoped cached observations, not a trade ledger or safe optimistic basis. Existing display models also use double and must not be reused for monetary mutation arithmetic.

Before mobile enablement: define coherent reconciliation for pending commands and stale portfolio reads, implement exact local projections and conflict UX, and test local atomic rollback, lost acknowledgement, pull ordering and restart. Backend PostgreSQL regressions cover cross-device sync replay with no duplicate events, settlement, authorization loss, ID collisions and exact replay after later trades. The migration has been tested only on isolated PostgreSQL, not applied to the development database. Mobile must not fall back to online-only writes while these requirements are unmet.
