# Group pockets

Purpose-based group pockets are separate persisted entities, not aliases for `group_accounts`. They label the full balance of selected accounts; no funds are moved, reserved, split, converted, or posted to the ledger. Duplicate pocket names are allowed. Empty pockets remain visible.

## Mobile contract

All paths below are prefixed by `/api/v1`. Authentication and active membership in a live group are required for every operation. No additional RBAC permission is required.

- `GET /groups/:groupId/pockets`: standard ApiResponse, `data` is an array of `{id,name,description,balances:[{currency,balance}],accounts:[{account_id,name,owner_user_id,owner_name,currency,balance}]}`. Description is nullable. `total_data` counts pockets. No pagination (agreed array contract).
- `POST /groups/:groupId/pockets`: body `{name,description?}`; 201 with the new empty pocket as `data`. Name is trimmed, 1–120 characters; optional description is trimmed and at most 2000 characters. Unknown fields rejected.
- `PATCH /groups/:groupId/pockets/:pocketId`: body `{name?,description?}`; 200 with the updated pocket as `data`. Updates name and/or description. At least one field required.
- `DELETE /groups/:groupId/pockets/:pocketId`: 200 with `data: null`. Removes the pocket and unlinks all accounts from this pocket; leaves member private accounts and base group sharing untouched.
- `POST /groups/:groupId/pockets/:pocketId/accounts`: body `{account_id}`; 200 with `data: null`. Repeating an assignment to the same pocket is idempotent. Assignment to another pocket in this group returns 409; unlink first. Different groups may independently use the same account.
- `DELETE /groups/:groupId/pockets/:pocketId/accounts`: body `{account_id}`; 200 with `data: null`. Idempotently removes only this pocket link, not the original `group_accounts` grant. Cleanup of an owned deleted/non-leaf account is allowed.

Only the actor's own live accounts with a live same-owner account type and no live children may be assigned. A child must have a live same-owner parent/type. Writes lock owner before group, revalidate active membership, and commit the pocket assignment and any missing `group_accounts` consent atomically. Composite foreign keys prevent cross-group pocket links; a unique `(group_id,account_id)` prevents double counting across pockets, including concurrent requests. Missing pocket: 404; foreign account/nonmember: 403; invalid leaf: 422.

Reads use a RepeatableRead snapshot and require the existing group sharing consent, active account-owner membership/user, live owned account/type, live owned parent/type where applicable, and no live children. Invalid or revoked links are omitted from both account detail and totals. They do not alter unrelated sharing. Account labels are transparent: `Parent - Child` or the root name; owner name is `users.name`. No account number, email, notes, profile or credentials are selected. Every balance is exact decimal text with two fractional digits, including negative values and sums beyond JavaScript Number precision. Totals are independent by currency; no FX conversion. Responses are `Cache-Control: no-store`.

Leaving/removal clears the departing member's pocket links along with existing sharing/mapping opt-ins, preventing silent restoration on rejoin. Pocket entities remain. Existing account, membership, reporting, and category routes are preserved. Any active member may now create a category through the existing category creation endpoint; category edits/deletion remain OWNER-only.

## Deployment and verification

Additive migration: `prisma/migrations/20261104000000_group_pockets/migration.sql`. No existing grants are backfilled into pockets. Apply migrations via the normal deployment process before serving these endpoints; no development database migration is required during implementation. Prisma client generation is required. Pockets are online collaboration data, not new sync ledger entities.

Unit/HTTP contracts: `tests/unit/group-pockets.test.ts`. PostgreSQL tests: `tests/integration/group-pockets.integration.test.ts`, using only the isolated tmpfs PostgreSQL harness. The harness applies migrations only to its newly created random integration container and does not reset, drop, truncate or clean up databases/volumes.
