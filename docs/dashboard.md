# Dashboard summary

`GET /api/v1/dashboard/summary` requires an access Bearer JWT and an active authentication session. No additional RBAC permission is required.

Required query parameters (unknown keys and repeated values are rejected):

- `period=daily`, `value=YYYY-MM-DD`
- `period=monthly`, `value=YYYY-MM`
- `period=yearly`, `value=YYYY`

Optional `end_value` uses the same format as `value` for the selected `period` and defaults to `value` when omitted. Both values must be real Gregorian calendar dates, with years from 1000 through 9998; `end_value` must be greater than or equal to `value`. Empty, repeated, malformed, impossible, or reversed ending values return 422.

The ending period is inclusive. Boundaries are calendar midnight in fixed WIB (UTC+7): `start_at` starts `value`, and the exclusive `end_at` is the start of the period immediately after `end_value`. For October 2026, `start_at` is `2026-09-30T17:00:00.000Z` and `end_at` is `2026-10-31T17:00:00.000Z`. Existing queries without `end_value` retain their single-period bounds.

For example, `?period=monthly&value=2026-10&end_value=2026-12` includes all of October through December, with `start_at=2026-09-30T17:00:00.000Z` and `end_at=2026-12-31T17:00:00.000Z`.

The standard success envelope contains `data` with `period`, `value`, resolved `end_value` (always present, even when omitted from the query), `timezone` (`Asia/Jakarta`), `start_at`, `end_at`, `income_total`, `expense_total`, and `net_cashflow`. Monetary values are decimal strings with two fractional digits; net cashflow is income minus expense and can be negative. Empty totals are `0.00`.

Both sums use one PostgreSQL RepeatableRead transaction snapshot. Transactions must be live (`deleted_at IS NULL`), non-transfer (`transfer_id IS NULL`), and have type INCOME or EXPENSE. Account visibility follows the shared accessible-account policy, including active owned accounts and active group-shared accounts. The transaction timestamp must fall within the period. No currency conversion or caching is performed. Responses use `Cache-Control: no-store`.

Invalid query input returns 422. Other documented statuses are 400, 401, 429, 500, and 503. Runtime schemas and the OpenAPI definition are registered alongside the dashboard router.

Unit tests cover calendar boundaries, leap years, strict queries, aggregate filters, snapshot isolation options, empty sums, and decimal arithmetic using fakes; they do not connect to PostgreSQL or Redis.
