# Credit Cards — Simplified Backend Delivery Plan

Status: backend implementation audited and completed in the working tree, 2026-11-07. Additive migration is provided but has NOT been applied to a persistent database. Web/mobile compatibility and coordinated rollout remain unverified.

Canonical requirements: [CC-PRD-01](credit-cards-prd.md). Companion plans: `vesper-web/docs/credit-cards-implementation.md` and `vesper_mobile/docs/credit-cards-implementation.md` in their respective repositories.

## Scope and accounting

Reuse existing accounts, ordinary EXPENSE purchases and existing atomic bank-to-card TRANSFER repayments. Add no credit-card module, command, cancellation protocol, ledger or queue. Statements, installments, specialized refunds, issuer cash refunds, cash advances, reminders, imports and automated billing/interest are out of scope, not later delivery phases. Payments record external actions; they do not execute bank payments.

For exact signed balance B and tracked contractual limit L:

- Debt = max(-B, 0); overpayment credit = max(B, 0).
- Remaining contractual limit = L - debt, never L + B; null L means untracked.
- Purchase x subtracts x from B and counts as spending once. Repayment x subtracts x from the bank and adds x to the card atomically, without income/expense.
- Over-limit purchases and lower-limit edits are allowed; limits are advisory.
- Overpayment is allowed with nonblocking information only. Positive B is “Kelebihan Bayar”, consumed by subsequent ordinary expenses; never forfeited or automatically refunded by the issuer.
- Manual fees/posted interest use ordinary EXPENSE. Any bank fee is a separate EXPENSE, not transfer principal.

## Implemented backend behavior

- Account Prisma fields, positive-limit database checks, strict Zod contracts, DTOs and existing OpenAPI registration include the new metadata. Existing sync create/update/pull reuse those contracts and repositories; omitted PATCH/sync fields preserve metadata. Balances and versions remain strings.
- Cards are immutable explicit classifications: own private IDR CASH root leaves, zero initial balance. A card cannot become a parent, be shared, join a pocket, be mapped to an obligation, fund investments, goals, bills or emergency plans. Existing mapped-obligation mutation locks remain active.
- Purchases and manual fees use ordinary EXPENSE. Incoming same-owner CASH transfers reuse existing atomic ledger/replay behavior. Card-origin transfers and INCOME are rejected; limits and positive card balances never add a blocking gate.
- Net worth counts signed balances once; mapped obligations retain existing deduplication. Liquidity and emergency funds exclude cards. Asset allocation retains positive card credits as UNCLASSIFIED non-cash assets. Dashboard/budget spending uses EXPENSE and excludes principal TRANSFER legs. Historical observations are not rewritten.
- Sharing writes, common account access, sync point/batch reads, and raw SQL group collaboration/pocket readers exclude explicit cards, including stale sharing rows.
- Bill creation/payment and linking an existing transaction reject card accounts, including inconsistent historical schedules; linking cannot bypass the payment-account restriction.
- No new module, command, queue, opening adjustment, derived-limit API or card reversal protocol is introduced. Clients calculate debt/overpayment/remaining limit exactly from balance and limit.

## Delivery checklist and original scope

### BE-01 Account metadata, migration and contracts

- Inspect existing account/schema, transaction, transfer, obligation, sync and reporting code/tests before implementation.
- Add account `is_credit_card` default false and nullable positive exact-decimal `credit_limit` through a small reviewed additive Prisma migration; retain compatible CASH/INVESTMENT enums, with explicit new cards using CASH.
- Extend existing create/edit/read Zod, DTO, OpenAPI and account sync contracts. Transport limits as decimal strings or null; retain exact balance and opaque version strings. Preserve omitted fields from older clients rather than clearing existing metadata.
- Use flag-based identity, never names/icons. Limit creation to private, own, IDR leaf accounts and same-owner bank payment sources; reject group sharing at online and sync authorization boundaries.
- Preserve inclusion/lifecycle safeguards and existing mapped-obligation account locks. No conversion, name-based backfill, mapping changes or historical rewrites.
- Use zero initial balance if no safe opening representation exists. Defer opening-debt UI rather than fabricate income, expense, transfer or an adjustment engine.
- Request no PAN, CVV, PIN, expiry or bank credentials; preserve owner-scoped access and safe logs/errors.

### BE-02 Existing transaction and sync paths

- Reuse ordinary transaction validation/services for purchases and the existing atomic transfer operation for repayment; retain exact positive amount, ownership, expected-version and concurrency safeguards.
- Preserve existing replay/conflict behavior, stable IDs, tombstones and authoritative pull reconciliation. No new card commands or independently queued transfer legs.
- Extend account push/pull serialization with compatible defaults and round-trip preservation; verify old/new clients before enabling creation.
- Preserve pending mobile work on network/auth failure. Web remains online-first; mobile remains local-first through its existing outbox.

### BE-03 Reporting and release

- Exclude limits and positive card credits from liquid cash/emergency funds despite the CASH category.
- Count signed B in net worth exactly once under existing inclusion settings and mapped-obligation rules: negative is debt, positive is a non-liquid asset. Never add a duplicate liability or rewrite snapshots.
- Include purchases/manual fees/interest in budgets and spending; exclude repayment principal.
- Deploy additive schema/contracts and compatible clients before enabling creation. If compatibility is unproven, keep creation disabled while preserving reads, history and pending sync; never reset data.

## Required tests and evidence

- Account/API/sync: false defaults, null/positive limit validation, exact fractional transport, large opaque versions, older-client field preservation, private access, group-sharing refusal and locked legacy mappings.
- Shared fixture: existing B = -2000000.00 → pay 2500000.00 → B = 500000.00 → spend 200000.00 → B = 300000.00 → spend 400000.00 → B = -100000.00. No extra overpayment confirmation.
- Limit fixture: L = 1000000.00, debt = 1200000.00 gives remaining -200000.00; lower-limit edits save without changing B. Null limit remains untracked.
- Transfer rollback/concurrency, duplicate replay, lost response, authoritative pull without double application, zero-balance creation, liquidity exclusion, spending once and signed net worth once.
- Coordinate mobile local atomic failure/restart tests and exact received fractions; whole-IDR mobile entry must reject unsupported fractions, never truncate them.

## Verification recorded 2026-11-07

Scripts were inspected before execution. No persistent database migrations, resets, destructive commands, or frontend edits were performed.

| Check                                                                                                | Actual result                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`                                                                                       | Passed repository-wide.                                                                                                                                                                                                            |
| `npm run typecheck`                                                                                  | Passed, including expanded integration fixtures.                                                                                                                                                                                   |
| Focused Vitest account/card, transaction/batch, transfer, net-worth, allocation and group-read tests | 7 files, 77 tests passed.                                                                                                                                                                                                          |
| `npm run test:integration:postgres`                                                                  | Final run: all 14 files / 69 tests passed, including 7 card integration tests.                                                                                                                                                     |
| `npm run build`                                                                                      | Passed; prebuild generated Prisma client, not a database migration.                                                                                                                                                                |
| `npm run openapi:validate`                                                                           | Passed; specification generated and validated.                                                                                                                                                                                     |
| `npm test`                                                                                           | 39 files passed, 1 failed; 326 tests passed, 1 failed at audit baseline. Pre-existing collaboration mock lacks `groupPocketAccount.deleteMany` in `tests/unit/collaboration.repository.test.ts` (self-leave test). Left untouched. |
| `npm run validate`                                                                                   | Attempted; stopped at repository formatting check (20 existing files, including unrelated files and group readers already changed at handoff). No global reformat performed.                                                       |
| `git diff --check`                                                                                   | Existing CRLF/trailing-whitespace changes in `docs/group-pockets.md`; preserved rather than rewriting user changes.                                                                                                                |

New regression evidence covers both-leg rollback on exhausted account version, online/sync INCOME rejection without ledger writes, exact fractional limit and large version preservation, explicit null limit clearing, actual batched pull privacy with stale sharing, emergency/goal/obligation refusal, investment funding refusal, and stale bill LINK_TRANSACTION refusal. Existing fixtures prove replayable overpayment, subsequent credit consumption, advisory lower limits, spending excluding principal, private card creation, and signed net-worth/liquidity separation.

The integration harness was inspected: it creates a fresh randomly named Docker Compose PostgreSQL instance with tmpfs storage, verifies its isolation, then applies migrations only there. Tests verify the isolated database/user. No cleanup commands were executed. The final successful project is `vesper-it-0e940969-f010-4c1d-b21b-3060b0550f93`; earlier audit runs also left isolated containers running, by harness policy. Stop/remove those only with explicit approval. Existing `pg` concurrent-query deprecation warnings remain non-fatal.

## Follow-up verification recorded 2026-11-07

This follow-up supersedes only the current blocker status above; the original audit results and container reference remain historical evidence. Verification was authorized, not deployment, persistent migrations, database resets or container/volume cleanup.

- Reproduced the collaboration failure before editing: `npm test` reported 39 passing files and 1 failing file; 328 tests passed and 1 failed (329 total). The missing transaction mock was `groupPocketAccount.deleteMany`, not a production repository defect.
- Updated only `tests/unit/collaboration.repository.test.ts` and this delivery document. Added the missing mock and assertions for target-scoped pocket/account/category opt-in removal. Expanded removal coverage to both self-leave and owner removal; denied removal and ownership transfer assert that opt-ins are not deleted. No production behavior changed in this follow-up.
- Final `npm test`: **40 files / 330 tests passed**. The additional owner-removal case increases the reproduced baseline total by one.
- `npm run typecheck` and `npm run lint`: passed repository-wide, including a repeat after the test fix.
- `npm run build`: passed, including Prisma client generation; generation does not apply database migrations.
- `npm run openapi:validate`: passed; generated specification validated successfully.
- `npm run test:integration:postgres`: latest fully captured run passed **14 files / 69 tests**. All 28 migrations applied only to fresh isolated PostgreSQL at `127.0.0.1:52814`, database `vesper_integration_test`, user `vesper_integration`, under project `vesper-it-3e96b51f-d10e-485c-b29b-af2038f92757`. The harness uses a random Compose project, tmpfs storage, isolation labels and loopback-only ephemeral port, with guarded integration configuration that never falls back to the application database. No cleanup was performed; retained integration containers require explicit approval to stop/remove. Non-fatal `pg` concurrent-query deprecation warnings remain.
- `npm run validate`: attempted and stopped at `format:check`, which reported **35 files** before any edits in this follow-up. Its chained lint/typecheck/test/build/OpenAPI stages therefore did not execute through that command; the independent checks above did execute. These baseline formatting issues include existing credit-card working-tree changes as well as unrelated files; none were broadly reformatted.
- Final focused checks: Prettier and `git diff --check` passed for both follow-up files; focused collaboration/card Vitest passed **2 files / 16 tests**. No formatter write command was used.
- Repository `git diff --check` still reports **29 trailing-whitespace locations across 2 existing files**: 26 in `docs/group-pockets.md`, 3 in `src/modules/groups/pocket.repository.ts`. Those unrelated changes were preserved. Follow-up files are checked separately.

No persistent schema changes, deployment, frontend/mobile edits, destructive operations, or container/volume cleanup were performed.

## Remaining release gates

- Review/apply the additive migration through an explicitly approved deployment; no persistent schema was changed here.
- Verify old/new web/mobile clients, exact decimal handling and mobile offline restart/reconciliation before enabling new card creation. This backend change does not add a rollout flag; gate creation in the coordinated release/client rollout until compatibility is proven.
- Resolve the existing repository formatting/whitespace blockers before claiming a green full `validate`. The collaboration mock blocker is resolved by the follow-up regression checks above.
- No statement/refund/cash-advance/adjustment workflow or opening debt is delivered; creation stays zero-balance and legacy obligation mappings stay authoritative.
