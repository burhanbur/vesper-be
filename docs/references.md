# Read-only reference API

`GET /api/v1/ref-account-types` and `GET /api/v1/ref-categories` list shared reference data from the existing Prisma `RefAccountType` / `RefCategory` tables, not user-owned financial records.

Both endpoints require a bearer access JWT, a valid Redis session, and an active non-deleted user. Ordinary authenticated users can read these lists; no additional RBAC permission is required. Existing API rate limits and request IDs apply. No create, update, delete, or detail endpoint is provided. These routes do not seed data or publish sync changes.

## Query contract

- `page`: integer 1–1,000,000; default 1.
- `limit`: integer 1–100; default 20.
- `sort`: `created_at`, `-created_at`, `name`, `-name`; default `-created_at`. ID is a stable tie-break in the same direction.
- `name`: optional trimmed, non-empty string (max 120 characters); case-insensitive substring.
- `type`: only on `/ref-categories`; optional exact `INCOME` or `EXPENSE`.
- Unknown query keys are rejected, including `type` on `/ref-account-types`.

## Response contract

HTTP 200 uses the existing success envelope: `success`, Indonesian `message`, envelope `timestamp`, `total_data`, `data`, and `pagination`. `total_data` is the current page's item count; `pagination.total` counts all matching rows. Pagination contains `total`, `per_page`, `current_page`, `last_page`, `from`, and `to`. Empty and out-of-range pages return `data: []`, `total_data: 0`, and null `from`/`to`; `last_page` is at least 1.

Account-type DTO fields: `id`, `name`, `created_at`, `updated_at`. Category DTOs additionally contain `type`. DTO timestamps are ISO 8601 UTC. There is no `user_id`, `version`, `deleted_at`, or account-type `category` field in these reference tables. Responses use `Cache-Control: no-store`.

Errors use the existing error envelope: 401 for invalid authentication/session/user, 422 for invalid query input, 429 for shared rate limiting, and 500 for unexpected dependency failures. Swagger UI and `/docs/openapi.json` document both lists with shared Zod contracts and examples.

## Composition and testing

`createApp` defaults to `PrismaReferenceRepository` against the ordinary Prisma client (no sync publication). Tests may inject the optional `referenceRepository` dependency; omission leaves the reference routes unmounted, following the existing feature composition pattern.

Focused tests in `tests/e2e/references.test.ts` use fake auth/session boundaries and a mocked reference repository, with no database writes. Repository query tests in `tests/unit/reference-repository.test.ts` verify model selection, filters, stable sorting, pagination, and matching counts without connecting to PostgreSQL. No migration or seed execution is required for this API change; an existing empty reference table simply yields an empty list.
