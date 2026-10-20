# Investment lifecycle (WM-05)

Entry: quick actions → Lihat Portofolio → Kelola. Account snapshots remain
separate server reads; Kelola uses the durable local owner cache for its summary
and trade history. Complete initial investment sync is required for totals and
financial commands. Shared portfolios are deliberately excluded from this owner
summary; account-scoped server reads retain their existing access policy.

## Supported financial rules

- IDR only. Quantity and price are decimal strings, up to 12 integer and 8
  fractional digits. Cash/fees use up to 18 integer and 2 fractional digits.
  BigInt/rational arithmetic on mobile matches the existing backend Decimal
  moving-average calculation. Cash rounds HALF_UP once after fee deduction or
  addition. Unsupported precision, zero/negative settlement, and overflow fail.
- BUY debits quantity × price + fee. SELL credits quantity × price − fee and
  reduces holdings. DIVIDEND credits quantity × payout per unit − fee and leaves
  quantity and average cost unchanged. Dividend quantity denotes entitlement
  units; it need not equal today's holding (for example after a record date).
- Fee includes taxes/withholding. Separate tax accounting is not supported.
  Purchase average excludes BUY fees, preserving the existing server policy.
- Contributed capital is cumulative BUY cash including fees, not net wealth or
  net deposits. Sale proceeds and net dividends are separate. Realized sale gain
  deducts sale fees; purchase fees are displayed separately. Unrealized gain is
  remaining units × (latest manual price − purchase average). Never add the
  linked cash ledger to holdings valuation; it is already in cash accounts.
- Quotes use the latest UTC price date not after today. Dates and cache-fetch
  time are displayed, with an explicit stale/offline warning; no real-time price
  claim. Missing prices leave the complete valuation null, never zero. Estimates
  may include local pending quotes and commands, clearly labelled.

## Persistence, delivery, and corrections

BUY/SELL/DIVIDEND use the same atomic local commit: immutable client trade UUID,
linked cash UUID, optimistic cash ledger/balance, and sync outbox. Retry reuses
the original envelope. Acknowledgement alone never clears a command: a complete
authoritative pull must supply trade, settlement, and cash balance. Interrupted
pulls, rejected commands, and lost responses retain existing retry/recovery
behavior. Dividend support requires the updated backend sync schema; an older
backend rejection must be retried with the original command after deployment.

Instrument creation and manual quotes first commit to SQLite with
`pending_catalog` and `investment_catalog_queue`. Background sync delivers these
before financial commands. Pending new instruments cannot be traded until their
creation is acknowledged. Instrument POST accepts an optional client `id`:
identical ID/metadata replays without writes, altered metadata conflicts, and
global code uniqueness is preserved. Existing clients may omit `id`.

Quotes reuse POST `/instrument-prices`, keyed globally by instrument/date:
last accepted update wins, including retries. The queue preserves the exact
payload and records errors; it never reports server success when delivery failed.
Refresh preserves pending catalog records. Failed delivery can be retried or
stopped from Kelola. Stopping removes speculative local values and dependent
quotes, does not undo any already accepted global change, and requires a catalog
refresh to inspect server state. No persistent database reset is required.

Manual quote corrections replace the same instrument/date. Accepted financial
records remain immutable; this release does not provide historical trade
edit/delete or automatic fee/tax corrections. A countertrade is a new financial
event, not an erasure. Existing recovery cancellation is only for commands an
authorized operator has verified were never applied; ordinary users cannot undo
accepted trades or reset balances by dropping an outbox item.

The local queue/read models use existing generic encrypted storage; no database
migration or new dependency is needed. Backend authorization, transaction locks,
versioned investment pulls, tombstones, and recovery fingerprints are preserved.
