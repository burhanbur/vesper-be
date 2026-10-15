# Group management reads

Both endpoints require a valid authenticated active user and membership in an active,
non-deleted group. OWNER and MEMBER have the same actor-only visibility; owning a
group does not grant access to other members' management rows. Missing membership,
missing groups, and inactive/deleted groups return the same generic 403 response.
No additional RBAC permission is required.

## GET /api/v1/groups/:id/accounts

Returns only the actor's existing sharing rows in this group. The account and its
account type must both belong to the actor and have `deleted_at = null`.
Visibility flags such as `is_visible` are presentation settings, not deletion.

Each item is exactly `{ id, group_id, account_id, name }`. `id` is the **sharing
row ID**, `account_id` is the underlying account ID, and `name` is the current
account name. No balance, currency, description, credentials, or other member's
account data is returned. This is not the shared-account access/discovery list
used by ledger endpoints.

## GET /api/v1/groups/:id/category-mappings

Returns only the actor's mappings to their own non-deleted personal categories.
The group category must belong to the requested group and its INCOME/EXPENSE type
must match the personal category type. Stale type-mismatched mappings are excluded
before counting and pagination. Mappings are independent of account sharing.

Each item is exactly `{ id, group_id, group_category_id, user_category_id }`.
`id` is the **mapping row ID**, not either category ID. No personal category names,
other member IDs, financial totals, or other members' mappings are returned.
Group categories and sharing/mapping rows have no tombstone/active flag in the
existing schema; their removal is physical. No migration is required.

## Pagination and response

- `page`: integer 1–1,000,000; default 1.
- `limit`: integer 1–100; default 20.
- Unknown query keys, duplicate parameters and malformed group UUIDs are rejected
  with 422. The actor always comes from authentication, never a query parameter.
- Stable ascending order by the sharing/mapping row's `created_at`, then `id`.
- Membership check, selected rows and filtered count use the same PostgreSQL
  `RepeatableRead` transaction snapshot. Subsequent requests can observe changes;
  this is not a cross-request snapshot or cursor contract.
- Standard success envelope: `success`, Indonesian `message`, `timestamp`,
  `total_data` (this page's length), `data` (array), and `pagination` with `total`,
  `per_page`, `current_page`, `last_page`, `from`, `to`.
- Empty or out-of-range pages return 200 with `data: []`, `total_data: 0`, and
  `from: null`, `to: null`; the filtered total remains accurate and `last_page`
  is at least 1.
- Both endpoints return `Cache-Control: no-store`.

The write endpoints and group category reports keep their existing semantics.
OpenAPI documents both new GET operations at `/docs/openapi.json`.
