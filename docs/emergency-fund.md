# Emergency fund planning (WM-09)

Entry: **Lainnya & Pengaturan → Dana Darurat**. This is an owner-private IDR
planning assessment. Settings save to local SQLite and the existing sync outbox
first. They do not move cash, create transactions, change balances/net worth or
rewrite any goal target. One undeleted plan per owner is enforced on the server.

## Baseline and target

Manual mode accepts a positive monthly essential-expense baseline with up to two
decimal places. History mode estimates a monthly baseline from explicitly selected
owned EXPENSE categories over the last 3, 6 or 12 **completed UTC calendar months**.
The current month is excluded. The date interval is half-open, from the first day
of the oldest month to the first day of the current month.

All eligible recorded expenses are summed and divided by the full number of
months, rounded **up** to cents. Months without transactions count as zero, not
as missing denominators. The display states how many months have expense rows,
labels sparse evidence, and offers manual input when history is insufficient.
Even a complete local download cannot prove that all statement transactions were
entered: every historical baseline remains labelled an estimate. Pending local
mutations are included. Missing/incomplete transaction snapshots, no selected
eligible categories or no positive expenses produce an **unknown** baseline,
never a misleading zero-cost/infinite-coverage result.

History includes selected categorized EXPENSE rows from owned IDR accounts, with
UTC timestamps inside the window and no tombstone. Transfers, income and derived
investment purchases without selected expense categories are excluded. Categorized
interest/fees count only if their categories were deliberately selected. Missing,
foreign or currency-mismatched account data is excluded. Deleted/ineligible
category selections are ignored with a warning. Full transaction pagination is
used; there is no first-page-only estimate.

The coverage target is baseline × 1–60 months. Manual configurations reject a
target beyond decimal(20,2). All arithmetic uses exact integer cents; no floating
point money calculations or FX assumptions are introduced. Displayed current
coverage is liquid funds / monthly baseline, floored to hundredths of a month.
Remaining target is max(target − eligible liquid funds, 0). Unknown baseline or
funds stays unavailable. A baseline of zero never means unlimited coverage.

## Eligible funds and goals

The user explicitly selects owned, active, IDR leaf CASH accounts/pockets. Parent
accounts, investment/noncash accounts, mapped obligation accounts, other members'
accounts and other currencies are excluded. Negative cash backs zero. Hidden
accounts may be deliberately selected and are identified as hidden in settings;
the dashboard's include-total preference does not override this explicit selection.
No accounts are silently included by default.

For each selected account, eligible funds are:

`positive unallocated cash + backed allocations to the optional emergency goal`

WM-08 supplies both values. All other goal reservations, including completed
milestones whose allocations were not withdrawn, stay excluded. An optional goal
must be owned, private, undeleted and IDR. Only its allocations from selected
accounts count, and only to the extent backed by current cash under WM-08's
oldest-first policy. This counts each unit of cash at most once, without treating
an earmark as a new asset. A missing/ineligible linked goal contributes zero with
a warning; linking never changes its target or funding. The account breakdown
explains free and goal-earmarked components. Initial goal history must be complete
before the total liquid amount/coverage is considered available.

This is a local planning estimate, not a guarantee of withdrawal access or a
bank-certified balance. Balance privacy masks monetary amounts and coverage.

## Sync and privacy

`emergency_plans` uses the existing versioned CREATE/UPDATE/DELETE sync envelope.
Fields: `currency` (`IDR`), `baseline_mode` (`MANUAL`/`HISTORY`), nullable
`manual_baseline` (required positive in manual mode, null in history mode),
`coverage_months` (1–60), `history_months` (3/6/12), unique UUID `account_ids`
(max 100), unique UUID `category_ids` (max 200), nullable `goal_id`.

Every save rechecks ownership and eligibility of referenced data on the server.
Sharing an account/household never shares the emergency plan. Pull rechecks the
owner and active user; publications go to that owner only. Derived assessment
values are recomputed locally, not persisted as authoritative server balances.

First opening bootstraps settings from cursor zero. Opening during an existing
sync cannot incorrectly mark previously skipped history complete. Configurations
can be saved offline; concurrent first-time creation on another device conflicts
against the one-live-owner constraint and can adopt the server plan. Commands
wait behind pending linked goal/account/category metadata. Retry retains UUID,
payload and expected version. Rejected/conflicting changes have explicit retry
or adopt/discard controls. Unknown-delivery pending commands cannot be discarded.
Server versions resolve conflicts without automatic financial-data merging.

## Backend rollout and validation

Deploy additive migration `20261021020000_emergency_plans` and regenerate Prisma
before using the updated backend. It adds an owner-private settings table, foreign
keys, a partial unique owner constraint, valid-mode/money/month/JSON checks and
the new sync entity. No existing balances or transactions are migrated. The
optional goal reference remains valid across soft archival; eligibility is
re-evaluated in the assessment and when settings are saved.

Tests cover exact arithmetic, zero/unknown baseline, full UTC windows and sparse
months, paging, ownership/liquidity exclusions, WM-08 reservation/backing reuse,
offline persistence/retry/bootstrap, recovery/session isolation, UI form feedback,
and PostgreSQL versioning/private publications/singleton concurrency. Exact check
results and any device limitation are recorded in the roadmap delivery log.
