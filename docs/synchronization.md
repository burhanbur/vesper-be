# Synchronization (PRD 5.10)

## API contract

Only `account_types`, `accounts`, `categories`, `transactions`, and `user_profiles` participate. All routes require an active authenticated user and an owned registered device. OpenAPI is the contract source.

- `GET /api/v1/sync/pull?device_id=<uuid>&since_version=0&limit=100`: ascending globally ordered events, latest authorized entity payload, `next_version`, `watermark`, and `has_more`. Versions and monetary values are decimal strings. Maximum page size is 100; no retention/pruning is implemented.
- `POST /api/v1/sync/push`: `{ device_id, items }`, maximum 100 sequential items. Each item contains `entity_type`, `entity_id`, `operation`, `payload`, and `client_version`. Each has its own transaction and returns `applied`, `conflict`, or `rejected`. Invalid items do not discard valid siblings. Unexpected dependency failures return an HTTP error; already committed items remain committed and may be retried.
- CREATE: client-supplied UUID, `client_version: "0"`, existing REST create payload. UPDATE: positive entity version, existing REST patch payload **without** `version`. DELETE: positive entity version and `payload: null`. Profile identity is the current user's UUID and its version is not an optimistic-lock token.
- There is no acknowledgement endpoint. `devices.last_sync_version` records the highest **delivered** cursor, not proof that a client applied it. Pull never substitutes this value for the explicit `since_version`. Clients must persist their own cursor only after atomically applying the page. A lost response is safely retried using the old local cursor, including empty pages.

Batch conflicts use HTTP 200 with per-item `conflict`; clients must inspect results, not only the HTTP status. Error server data is supplied only after an authorized lookup; foreign UUID collisions return a generic conflict without another owner's data.

## Atomicity and ordering

The default application injects an observed Prisma client into participating repositories. Their existing mutation validation, owner/grant locking, hierarchy checks, optimistic locking, and ledger recomputation remain the only business-rule implementation. Push uses a transaction adapter to invoke those same repository methods without opening nested transactions.

All observed transaction callbacks acquire PostgreSQL advisory lock `5786933010410` **before** any domain lock. Finance/profile/group writers and online investment writers follow this order. Investment callbacks acquire this lock but suppress publication. Event identity versions are allocated after domain mutations, while the lock remains held until commit. Rolled-back sequence gaps are harmless; committed event versions cannot overtake an earlier uncommitted writer. Pull takes the same lock and reads payloads, current authorization, and watermark coherently.

This intentionally serializes writers and pull across users. It trades throughput for a reliable global cursor. Direct database writes, alternate unwrapped repository construction, migration/seed scripts, or future grant writers are outside this publication boundary: they must use the same adapter or an explicitly reviewed lock/publication protocol. Grant changes through the current group join/share/unshare methods are covered. New membership removal/group deactivation endpoints must use it too; changing user status alone is not a grant-transition publication trigger.

## Authorization and fan-out

Account and transaction recipients are the account owner union distinct active members of active groups sharing that account. Transaction moves notify recipients of both former and new accounts; pull delivers a tombstone to viewers who can no longer access the transaction. Account balance and parent inclusion updates are published in the same transaction as their triggering mutation.

Join/share publishes account history, its type, and its owner's categories to newly entitled users. Unshare publishes visibility tombstones for the same entities to users losing their last account entitlement. These tombstones do **not** delete the source entity globally. Pull resolves current access: if another grant still exists, it returns current data rather than removing a still-readable entity. Deleted or inaccessible entities have `operation: DELETE` and `payload: null`; no former payload is exposed.

An owner's categories are readable to users with an active accessible account belonging to that owner, supporting the shared-account category dropdown. Account types are readable only when used by an accessible account. Neither policy grants metadata mutation permissions: types/accounts/categories remain owner-editable only. Profiles are private to their owner. Group categories are not offline entities. Shared metadata changes fan out to currently entitled users.

## Retry semantics

CREATE replays are accepted without duplicate writes only when canonical persisted editable fields match the validated input, the entity is active, and its latest relevant event came from the same device and operation. Monetary and timestamp comparisons are normalized. Changed payloads or later mutations return conflicts.

Versioned UPDATE/DELETE replays are bounded content-based idempotency: the persisted entity must be exactly at `client_version + 1`, the latest relevant event must match the device/operation, the requested editable fields must match (or the entity must be deleted), and transaction audit actor must match. They produce no additional writes/events. This is not a durable request-ID deduplication ledger: after intervening writes, even a formerly successful retry can conflict. The ERD has no request hash/idempotency key table, so arbitrary historical replay identification cannot be promised.

Profiles have no ERD version column: changes are serialized last-writer-wins; equal active profile patches are no-ops. Profile DELETE is soft deletion, and a same-device deletion replay is accepted. Deleted profiles cannot be recreated through patch.

## Online-only operations

Transfers are online-only writes because `transfers` is not a scoped offline entity. Their two transaction legs and changed account balances are published; no transfer entity or private counterpart account name is included. Direct offline creation/editing of TRANSFER legs is rejected.

Investment entities and their derived cash transaction rows are excluded from bootstrap, grant snapshots, push, and pull. Investment writes do not publish cash account balance events either. Account payloads fetched later can still reflect the authoritative current balance, including investment effects: this is an account snapshot, not an investment event feed. Clients must refresh online account/transaction views after investment writes and must not claim offline cash-ledger completeness. This resolves backend principle 3's broad investment fan-out wording in favor of explicit principles 7 and PRD 5.10's investment exclusion. No investment-specific fields are exposed through sync.

## Deployment and verification

Migration `20261004090000_add_sync_changes` is additive and includes initial historical events, including existing shared-account audiences. It does not reset/delete domain data. Stop application writers while deploying this migration; then deploy the new writer protocol before allowing traffic. Backfill uses UUIDv7-shaped migration-time event IDs with cryptographic randomness; runtime events use the existing application UUIDv7 generator. Bootstrap is read using normal bounded pull pages from version zero. Clients should stage/apply related payloads within a local transaction, since latest-state references may precede another entity's event.

The migration has **not** been applied or PostgreSQL-executed during implementation. No tests were run, as requested. TypeScript, affected-file lint/format, generated OpenAPI validation, and whitespace checks are the implementation checks; they do not establish runtime concurrency, SQL backfill, or database integration correctness. Before production, verify rollback atomicity, concurrent commit ordering, retry conflicts, transfer legs, join/share/unshare transitions, private data redaction, and migration backfill against an isolated PostgreSQL database.

Grant snapshots enumerate affected account histories and metadata inside the transaction; large groups/history can exceed Prisma's default interactive-transaction timeout and hold the global lock too long. A bounded SQL fan-out or carefully designed asynchronous transactional snapshot protocol is a follow-up for large deployments. No silently truncated grant history is returned.
