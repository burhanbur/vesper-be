# Credit Cards — Simplified Product Requirements

- Document ID: CC-PRD-01; updated 2026-11-06.
- Status: approved scope; backend implementation and verification are recorded in the delivery plan. Cross-client rollout remains unverified.
- Supersedes the previous complex command, statement and installment design in these four documents.
- Systems: vesper-be, vesper-web, vesper_mobile; this is the canonical scope.
- Delivery: [backend plan](credit-cards-implementation.md); web/mobile plans are identified below.
- Documentation/contracts are English; application user-facing copy remains Indonesian.

## 1. Scope and baseline

Reuse normal accounts, ordinary EXPENSE purchases, and existing atomic bank-to-card TRANSFER payments.
Do not add a card module, card-specific command/cancellation protocol, separate ledger or new queue.
Existing account categories are CASH/INVESTMENT; keep those public category values compatible.
Existing obligation mappings lock legacy accounts and must remain authoritative.
Mobile currently uses AppState/ChangeNotifier and Navigator; preserve that implementation.

## 2. Minimal account metadata

- Add a stable account-level subtype flag, proposed `is_credit_card`, default false.
- Keep explicit new cards compatible with CASH; do not mandate a LIABILITY category enum.
- Classification comes from this flag, never account names, keywords or display icons.
- Add nullable decimal `credit_limit`; positive when supplied, null means untracked, not zero.
- Transport the limit as an exact decimal string or null; retain exact balance/version strings.
- Use existing account create/edit/read APIs and sync account fields; no separate card resource.
- Start with private, own, IDR leaf accounts and same-owner bank payment sources.
- Block group sharing of explicit new cards at existing API/sync authorization boundaries.
- Preserve existing inclusion settings and account lifecycle safeguards; do not erase financial history.
- Do not request PAN, CVV, PIN, expiry or bank credentials.

## 3. Accounting and display

Let B be the signed account balance and L a tracked contractual credit limit.
Use exact decimal arithmetic or integer minor units, never floating point.

- Debt = max(-B, 0); overpayment credit = max(B, 0).
- Purchase x: ordinary EXPENSE subtracts x from B and counts as spending once.
- Payment x: existing atomic TRANSFER subtracts x from bank and adds x to card.
- Principal payments are not income or expense; both payment legs commit or neither does.
- Show remaining contractual limit as L - debt, including a negative result when over-limit.
- For null L, show an untracked limit; do not invent zero or a remaining-limit estimate.
- Show overpayment separately; do not promise it increases issuer spending capacity.
- Limits are advisory: NEVER block an over-limit purchase or a lower-limit metadata edit.
- Overpayment is allowed with nonblocking information only, not an extra confirmation gate.
- Credit is never forfeited: the next ordinary EXPENSE automatically subtracts from positive B.
- Fees and posted interest are manually entered ordinary EXPENSE, not automated accrual.
- A separate bank fee, if recorded, is its own existing EXPENSE, not transfer principal.

Example, starting with existing debt of 2000000.00 (not an opening-balance write):

| Action                  | Signed B    | Debt       | Overpayment |
| ----------------------- | ----------- | ---------- | ----------- |
| Existing debt           | -2000000.00 | 2000000.00 | 0.00        |
| Pay 2500000.00          | 500000.00   | 0.00       | 500000.00   |
| Spend 200000.00         | 300000.00   | 0.00       | 300000.00   |
| Spend another 400000.00 | -100000.00  | 100000.00  | 0.00        |

With L = 1000000.00 and debt = 1200000.00, show remaining limit -200000.00.
Lowering L below existing debt must still save; it changes metadata, never B.

## 4. Reporting and opening balances

Exclude credit limits and positive card overpayments from liquid cash and emergency funds.
Apply explicit classification even though the compatible account category remains CASH.
Count signed B in net worth exactly once, respecting existing inclusion and obligation mappings.
Negative B is debt; positive B is a non-liquid asset, not extra cash.
Do not add a second liability beside an existing mapped obligation or rewrite historical snapshots.
Budgets/spending include purchases and manual fees/interest, never principal transfers.

Never create fake opening income/expense or a fabricated bank transfer.
For MVP, create new cards with zero initial balance if no safe opening representation exists.
Defer opening-debt UI rather than invent unsupported ledger writes or a new adjustment engine.

## 5. Existing workflows and precision

- Backend extends existing account API/Zod/OpenAPI schemas and sync account serialization only.
- Purchases use existing transaction validation/services; payments use existing transfer safety.
- Preserve ownership, exact positive amount validation, expected versions and atomic ledger behavior.
- Reuse existing replay/conflict rules; no special overpayment command or cancellation infrastructure.
- Mobile saves accounts/transactions/payments locally first through the existing outbox.
- Keep stable IDs, atomic local payment legs, retry/restart replay and authoritative pull reconciliation.
- Never queue the two payment legs independently or apply acknowledged deltas twice.
- Preserve pending work on network/auth failure; connectivity only triggers sync.
- Web stays online-first with existing forms/client/query invalidation, not a new offline queue.
- Preserve exact decimal money and opaque version strings end to end, including received fractions.
- Mobile entry currently supports whole IDR only: make that restriction explicit and reject fractions.
- Display fractional received values exactly; block unsupported editing with explanation, never truncate.

## 6. Exclusions and legacy safety

Specialized refunds, cash advances, issuer cash refunds, automated billing/interest, statements,
installments, notifications, imports and bank payment execution are out of scope, not delivery phases.
Do not represent a refund as INCOME; a safe specialized refund workflow requires separate approval.
Do not introduce a card-specific reversal/cancellation service or new financial module.
A payment records an action performed outside Vesper; it does not send money to the bank.

Legacy obligation-mapped accounts remain locked; no automatic migration or name-based conversion.
Do not change mapping ownership, duplicate debt or silently reclassify historical records.
Any future conversion requires separately reviewed scope; it is not part of this delivery.

## 7. Rollout and acceptance

1. Review a small additive Prisma migration for account fields; never reset data or destructively backfill.
2. Update existing API/Zod/OpenAPI examples and account sync fields, with compatible defaults.
3. Verify old/new client parsing, field preservation, privacy and reporting before enabling card creation.
4. Deliver compatible web/mobile account flows; preserve existing AppState/Navigator and outbox.
5. Disable new card creation if compatibility is unproven; retain existing data, reads and pending sync.

Acceptance fixtures must prove zero-balance creation, null/positive limit validation, explicit identity,
over-limit purchase, lower-limit edit and the overpayment example above without a blocking gate.
Also prove transfer rollback/replay, exact fractional transport, large version strings, liquidity exclusion,
signed net worth once, locked legacy mappings and group-sharing refusal on online/sync paths.
Mobile tests must cover local atomic failure, restart, lost response and authoritative pull without duplication.
Future implementation uses isolated database tests; never clean up persistent development financial data.
These are implementation gates, not test results claimed by this documentation change.

## 8. Platform plans

- Backend: [delivery plan](credit-cards-implementation.md).
- Web: `vesper-web/docs/credit-cards-implementation.md` in its repository.
- Mobile: `vesper_mobile/docs/credit-cards-implementation.md` in its repository.

Repository identifiers are not deployed links; mobile may live on a different filesystem.
These requirements do not themselves implement runtime behavior. See the backend delivery plan for actual working-tree implementation, verification results and remaining rollout gates.
