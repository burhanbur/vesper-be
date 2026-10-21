# Goals and household allocations (WM-08)

Entry: **Lainnya & Pengaturan → Goal & Target**. Create a personal goal or select
an active household. The creator owns metadata; sharing never transfers ownership
of the goal or the contributing account. Currency, household and UTC start date
are immutable. Name, target, deadline and milestone status can be updated.

## Money and allocation policy

Targets and allocations use exact decimal(20,2) strings and integer cents on
mobile, with no floating-point money calculations or exchange-rate assumptions.
A goal may name any three-letter currency; funding requires an existing account
in exactly that currency. Current account creation supports IDR, so other-currency
goals remain planning targets until matching accounts are supported.

An allocation is an earmark, not an expense, transfer, new asset or locked cash.
It never changes account balances, transactions, reports or net worth. Only the
contributor's undeleted leaf CASH accounts/pockets qualify; mapped obligation
accounts and parent/investment accounts are excluded. Hidden accounts may be
allocated deliberately. An account has one allocation row per goal, and its
amount is the **total** allocated, not an increment. Set it to zero to withdraw;
the row and version are retained. No double counting between parent and child
accounts or between personal and shared goals is allowed.

Increasing an allocation requires its amount plus all other live commitments
from that account to fit within its current positive cash balance. The server's
existing global financial writer lock serializes this check across devices and
members; stale/concurrent attempts reject or conflict, never silently overdraw.
Completed goals continue reserving amounts until explicitly withdrawn. Archiving
a goal soft-deletes its allocations and releases reservations atomically.

Cash remains spendable through ordinary transactions. If it falls below total
commitments, actual **backed** progress uses positive available cash exactly once,
oldest allocation first (`created_at`, UUID). Deleted/ineligible accounts back
zero. The UI shows both earmarked and backed amounts and their shortfall.
Backing snapshots are republished after cash/allocation/eligibility changes.
For owned accounts mobile recomputes from the local ledger, including pending
changes; other members' backing is the last authorized server snapshot with its
timestamp. Offline values and pending changes are estimates, subject to sync.

Completion requires backed funds at least equal to target. It records a milestone
and does not spend, release or lock funds. Later spending/withdrawal may reduce
backing while the completed milestone remains visible; the creator can reopen it.

## Progress and pace

Use UTC calendar dates. Expected progress today is
`ceil(target_cents × clamped_elapsed_days / total_days)`; same-day goals require
the full target. Below expected means behind, otherwise on track. The UI reports
overdue separately and shows remaining funds even after the deadline.

Required monthly contribution is remaining backed target divided by the number
of remaining calendar months **including this month**, rounded up to cents and
with at least one period. These are explicit planning estimates, not an income,
interest or investment-return forecast. Progress above the target remains visible
in amounts while the progress bar caps at 100%. Balance hiding masks amounts.

## Household authorization

Private goals are visible only to their creator. Household goals require active
membership in an active household, including for the creator. Only that creator
edits, completes or archives. Members may earmark and withdraw their own funds;
they cannot change another member's allocations or write through a shared account
they do not own. Other viewers receive amount/backing and contributor identity,
but `account_id` is null and no account balance/name is disclosed.

Joining publishes existing shared goals/allocations. Leaving/revocation publishes
tombstones for inaccessible rows. A former member retains access to their **own**
allocation and can decrease/withdraw it without access to the goal. These appear
under “Alokasi saya — goal tidak tersedia”. This never restores household access.
Revocation tombstones remove local goal projections even if a command is pending;
the command remains reviewable with a rejected status.

## Offline sync and recovery

UI → observable controller → goals repository → durable SQLite entities/outbox →
existing `/api/v1/sync/push` and cursor pull → PostgreSQL. No new dependency or
separate REST endpoint is needed. First opening bootstraps goal history from
cursor zero. Initial offline creation works; increasing allocations requires one
complete history sync so the local reservation check has a baseline. Thereafter
edits save locally first. Server authorization/capacity remains authoritative.

`goals`: CREATE uses client UUID/version 0 and fields `name`, `currency`,
`target_amount`, `start_date`, `target_date`, nullable `group_id`. UPDATE sends
`name`, `target_amount`, `target_date`, `status` and expected positive version.
DELETE sends null payload and expected version.

`goal_allocations`: CREATE sends `goal_id`, `account_id`, `amount`; UPDATE sends
`amount`; DELETE is supported by the wire contract with a tombstone, while the UI
uses amount zero to preserve reusable row identity. DTOs add exact `backed_amount`
and `backing_checked_at`. Schema contracts and DTOs are registered in OpenAPI.

Pending envelopes retain UUID and expected version through retry and app restart.
Allocation commands wait behind unresolved goal metadata commands. Only one local
mutation per identity is queued, following the existing project convention.
UI shows pending/rejected/conflict status. Rejected commands can retry unchanged;
version conflicts can revalidate against the supplied server version. CREATE ID
conflicts must adopt server state before a new edit. Discarding a known rejection
restores server/before state; pending commands with uncertain delivery cannot be
discarded. Unsent allocation dependencies of a rejected new goal are removed
atomically when that goal is explicitly discarded. No conflict is auto-merged.

## Deployment and limits

Deploy additive backend migration `20261021010000_goals` and regenerate the Prisma
client before running the updated backend. Tables have foreign keys, version and
finite-money checks, date/status checks, unique goal/account identity and sync
entity constraints. No existing financial balances are migrated or rewritten.
The implementation limits each creator to 200 undeleted goals and rejects backing
queries beyond 10,000 account allocation rows rather than returning partial totals.

Validation evidence and any unexecuted device checks are recorded in the roadmap
delivery log. Migration validation uses isolated ephemeral PostgreSQL only.
