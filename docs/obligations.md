# Debt, receivables, and installments (WM-06)

## Scope and precision

The register is private to the authenticated owner. `PAYABLE` means money owed
to a counterparty; `RECEIVABLE` means money owed to the owner. Records store
counterparty, original principal at registration, current outstanding principal,
optional due date, explicit installment principal/date pairs, and event history.
For an existing balance imported without funding, registration principal is the
remaining principal being brought into the register; past repayments are not
invented. A new funding record starts outstanding equal to principal.

Only IDR is supported. Backend/local contracts retain exact decimal(20,2)
strings; all mobile calculations use BigInt cents. Inputs beyond two fractional
digits are rejected, never rounded. The existing general mobile account and
transaction views support whole Rupiah: the new forms therefore accept whole
IDR amounts and whole-IDR settlement balances. They explicitly reject fractional
entry. General fractional-IDR presentation remains outside this task; the exact
backend/local contract must not be converted to doubles or silently truncated for
financial mutations.

## Financial effects

| Operation          | Cash                                     | Outstanding principal  | Reports                                             |
| ------------------ | ---------------------------------------- | ---------------------- | --------------------------------------------------- |
| Fund payable       | +principal                               | +principal             | Protected TRANSFER, not income                      |
| Fund receivable    | −principal                               | +principal             | Protected TRANSFER, not expense                     |
| Import existing    | No new cash                              | Registration principal | No fabricated historical movement                   |
| Pay payable        | −principal −interest −fee                | −principal             | Interest/fees are separate categorized EXPENSE rows |
| Receive receivable | +principal +interest −fee                | −principal             | Interest is categorized INCOME; fees are EXPENSE    |
| Reverse repayment  | Undo all original ledger rows atomically | Restore principal      | Original rows tombstoned; audit event retained      |

Fees are explicit amounts, including any applicable payment charge; no assumed
interest schedule or automatic interest accrual is performed. A cost category of
the correct type is required for each nonzero interest/fee. Categorized costs
participate in existing spending/budget reports; principal does not.

Negative cash balances retain existing server policy. Repayment principal must be
positive and cannot exceed outstanding. Installments contain up to 360 strictly
increasing UTC dates and positive principal amounts whose sum equals registration
principal. If an overall due date is supplied, it equals the last installment.
Payments allocate principal to installment rows in order for display. Dates do
not create transactions or notifications automatically.

## Legacy account mapping and net worth

An existing leaf IDR CASH account can explicitly represent a legacy loan/card
balance: negative balance for PAYABLE, positive for RECEIVABLE, exactly equal to
registration principal. No sign is inferred from the account name, and no old
ledger history is rewritten. Positive card balances remain assets under the
signed-balance convention. Only an owner can map an account; a partial unique
index prevents two active records from mapping the same account.

Mapping replaces the account balance with the obligation component in net worth.
A principal repayment updates the mapped account toward zero and updates the
separate settlement account in the same transaction. This avoids both original
balance duplication and stale legacy balances after repayment. Existing account
exclusions are respected. Mapped accounts remain locked against unrelated
financial/metadata writes and becoming parents until the obligation is archived.

Current server assessments add owner receivables to known assets and subtract
outstanding payables separately from negative unmapped account balances. They
return `obligation_liabilities` and `receivables_value`. `status=complete` means
the recorded components are available; unrecorded obligations/assets are not
assumed to exist or valued. Missing prices or inconsistent/unavailable mapped
accounts keep `net_worth=null`. Market attribution remains unavailable separately.
First daily historical observations remain immutable, including older partial
WM-02 payloads; there is no retroactive backfill.

## Durable sync, corrections, and cancellation

`POST /api/v1/sync/push` supports CREATE-only `obligation_commands` with an
immutable client command UUID, `client_version=0`, and payload action OPEN,
REPAY, REVERSE, or DELETE. Payloads contain an obligation UUID and four distinct
client ledger UUIDs (`cash_principal`, `mapped_principal`, `interest`, `fee`).
Mutations of an existing obligation require its expected server version.
Obligations/events are read through the existing incremental sync feed; generic
edits/deletes of these entities and derived ledger rows are forbidden.

The mobile saves obligation/event, affected ledger rows, projected account
balances and the original outbox command in one local commit. Failed commits
restore memory and disk. The first use of the feature requires a complete feed
replay. One unresolved investment/obligation command at a time prevents unsafe
offline rebasing. Retry preserves its UUID, fields and version. Acknowledgement
alone is insufficient: all affected records must be received in a complete
authoritative pull before the local projection and outbox are reconciled.

Version conflicts retain the original command; never overwrite its version or
drop optimistic money locally. A failed command can be retried or submitted as
`obligation_cancellations` with the same ID and exact original payload. Under the
same sync writer lock, the server either reserves a never-applied command and
its ledger UUIDs, or returns `cancelled=false` for an already-applied command.
The latter reconciles the applied result rather than undoing it. Cancellation
publishes authoritative rows/tombstones, survives lost responses, and cannot
reverse accepted payments. Foreign ownership and UUID collisions refuse the
request without exposing another owner's data. A support reference preserves the
envelope when manual investigation is required.

To correct a repayment, use REVERSE: its ledger rows become versioned tombstones,
the event is marked reversed, outstanding is restored, and cash/mapped balances
are recomputed atomically. Record the corrected payment as a new event afterward.
DELETE voids untouched funding (reversing its cash) or archives a fully repaid
obligation without changing cash. Partially repaid records cannot be deleted;
reverse payments first or finish repayment. No persistent records or audit events
are physically erased. A previously accepted UUID always replays its existing
result, even after reversal/archive.

Obligations and events never become household-readable through a cash-account
share. Shared cash movements retain existing account access but expose only an
`is_obligation_settlement` flag, no obligation IDs or counterparty text.

## Rollout and development

Deploy additive migration `20261020160000_obligations` with normal reviewed
migration tooling, then the updated API, then mobile. Do not reset existing
databases. The migration adds records, foreign keys, finite/positive amount and
version constraints, mapped-account uniqueness, protected principal transfer
support, sync entities, and UUID reservation guards. Existing financial rows are
preserved. Local generic encrypted storage needs no schema reset or new package.

An older API rejects the new commands; keep them durable and retry after the
updated backend is deployed. UI entry is Settings → Utang & Piutang, or the
transfer form shortcut. After an Android integration test, rebuild/run
`lib/main.dart` to restore the normal application APK. VS Code launch targets
explicitly point to that entry point so test runner APKs do not leave a blank
screen when the app is launched again.
