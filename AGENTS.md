# AI Agent Guidelines — Express Starter Kit

You are an expert backend TypeScript AI assistant working on this repository. Follow these architecture, security, quality, and workflow rules strictly. This repository is an opinionated production-ready starter kit, not a throwaway demo.

---

## 1. Mission and Core Stack

- **Runtime:** Node.js 22 LTS.
- **Language:** TypeScript with strict type checking. Do not add JavaScript source files unless a tool configuration requires them.
- **Module system:** Native ESM (`NodeNext`). Include explicit `.js` extensions in relative imports when required by the compiler configuration.
- **HTTP framework:** Express 5.
- **Database:** PostgreSQL.
- **ORM and migrations:** Prisma. Schema changes must be represented by committed migrations; never use runtime schema synchronization in production.
- **Cache, distributed state, and queues:** Redis through `ioredis`. Redis is not the system of record.
- **Validation:** Zod. Define schemas at application boundaries and infer TypeScript types from them rather than duplicating interfaces.
- **API documentation:** OpenAPI 3.1 exposed through Swagger UI. Generate OpenAPI schemas from the same Zod contracts used for validation whenever practical.
- **Logging:** Pino with structured JSON logs.
- **Testing:** Vitest and Supertest. Use isolated test databases and mocked/fake external integrations where appropriate.
- **Package manager:** npm. Commit `package-lock.json`; do not introduce another package manager.
- **Local infrastructure:** Docker Compose for PostgreSQL and Redis. The application itself must also remain runnable directly with Node.js for fast development.

Use current stable package versions compatible with Node.js 22. Do not perform broad dependency upgrades unless requested.

### Language Policy

- Code, identifiers, database objects, API fields, logs, and technical documentation are written in **English**.
- User-facing API messages are written in **Indonesian**, unless a feature explicitly requires another locale.
- Keep comments concise and explain intent or trade-offs, not syntax.

---

## 2. Architectural Principles

Use a modular, feature-oriented architecture with explicit boundaries:

```text
src/
├── app.ts                    # Express application composition; no network listen
├── server.ts                 # Process bootstrap, listen, and graceful shutdown
├── config/                   # Validated environment and application configuration
├── infrastructure/           # PostgreSQL, Redis, logger, and external adapters
├── common/                   # Shared errors, middleware, contracts, and utilities
├── modules/
│   └── <module>/
│       ├── <module>.route.ts
│       ├── <module>.controller.ts
│       ├── <module>.service.ts
│       ├── <module>.repository.ts
│       ├── <module>.schema.ts
│       ├── <module>.types.ts
│       └── <module>.test.ts
├── docs/                     # OpenAPI composition and reusable components
└── jobs/                     # Background job definitions and workers
prisma/
├── schema.prisma
├── migrations/
└── seed.ts
tests/
├── integration/
├── e2e/
├── fixtures/
└── helpers/
```

### Dependency Direction

- Route → middleware/validation → controller → service → repository/infrastructure.
- **Routes** declare HTTP wiring only.
- **Controllers** translate HTTP input/output and call one service operation. Keep business logic out of controllers.
- **Services** own use cases, authorization decisions that require domain data, orchestration, and transaction boundaries.
- **Repositories** encapsulate reusable or complex persistence queries. Do not create pass-through repositories that add no value.
- **Infrastructure adapters** isolate third-party APIs and transport-specific SDKs.
- Modules may depend on `common` and infrastructure abstractions. Avoid circular dependencies and deep imports into another module's internals.
- Prefer small functions and dependency injection through explicit factory or constructor parameters. Avoid hidden mutable global state.
- Do not introduce a DI framework, event bus, CQRS, or additional abstraction layer without a demonstrated need.

---

## 3. TypeScript and Code Conventions

- Enable strict compiler options, including `strict`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes` where ecosystem compatibility permits.
- Do not use `any`. Use `unknown` at untrusted boundaries and narrow it safely.
- Avoid non-null assertions and unsafe type casts. If unavoidable, document the verified invariant.
- Prefer `type` for unions and data shapes; use `interface` for intentionally extensible contracts.
- Use named exports. Default exports are reserved for framework/configuration cases that require them.
- Naming:
  - files and directories: `kebab-case`
  - variables and functions: `camelCase`
  - classes, schemas, and types: `PascalCase`
  - constants and environment variables: `UPPER_SNAKE_CASE`
  - database tables and columns: `snake_case`
- Use `async`/`await`; do not mix promise chains into normal application flow.
- Never leave floating promises. Handle or deliberately discard them with an explanation.
- Keep functions focused. Extract domain logic rather than growing controllers or middleware.
- Use ESLint and Prettier as the canonical linting and formatting tools. Do not manually reformat unrelated files.

---

## 4. Configuration and Environment

- Read environment variables only in `src/config/`.
- Validate all environment variables at startup with Zod. Fail fast with a clear error when configuration is invalid.
- Application code imports typed configuration; it must not access `process.env` directly.
- Maintain `.env.example` with safe placeholders and document every variable.
- Never commit `.env`, credentials, tokens, private keys, production URLs, or real personal data.
- Required baseline configuration includes application environment, HTTP host/port, database URL, Redis URL, log level, CORS origins, and authentication secrets/expiry values.
- Secret values must never appear in logs or API error responses.
- Keep development, test, and production behavior explicit. Do not silently weaken production security settings.

---

## 5. HTTP and REST API Standards

- Prefix all endpoints with `/api/v1`. Introduce a new version instead of making an incompatible contract change.
- Resource paths use plural kebab-case nouns, for example `/api/v1/users`.
- Use HTTP methods and status codes semantically:
  - `200` successful read/update with a response body
  - `201` successful creation
  - `204` successful operation without a response body
  - `400` malformed request
  - `401` unauthenticated
  - `403` authenticated but unauthorized
  - `404` resource not found
  - `409` state or uniqueness conflict
  - `422` semantically invalid input
  - `429` rate limited
  - `500` unexpected server error
- Match the Laravel Starter Kit `ApiResponse` contract exactly. Successful responses use:

```json
{
  "success": true,
  "message": "Data berhasil diambil.",
  "timestamp": "2026-09-20 10:11:12",
  "total_data": 1,
  "data": {},
  "pagination": {
    "total": 42,
    "per_page": 20,
    "current_page": 1,
    "last_page": 3,
    "from": 1,
    "to": 20
  }
}
```

Error responses use:

```json
{
  "success": false,
  "message": "Permintaan tidak valid.",
  "timestamp": "2026-09-20 10:11:12",
  "errors": {}
}
```

- `pagination` and `errors` are optional. Non-production responses may include the Laravel-compatible `debug` object containing `url`, `method`, and, for errors, `original_message`; production must omit it.
- `total_data` is the current payload item count, while `pagination.total` is the total number of matching records.
- Propagate request IDs in the `X-Request-Id` header and logs without adding fields to this established response body.
- Never return stack traces, SQL, internal exception messages, or secrets.
- Parse and validate path parameters, query parameters, headers, and request bodies before controllers execute.
- Unknown object keys should be rejected or stripped according to an explicitly chosen schema policy; never pass unchecked request objects to Prisma.
- Pagination uses `page`, `limit`, `sort`, and documented filters. Enforce a safe maximum `limit` and return snake_case pagination metadata.
- Store and return timestamps as ISO 8601 UTC strings. Convert to local time only at presentation boundaries.
- Provide `/health/live` for liveness and `/health/ready` for dependency readiness. Keep health responses free of secrets.
- Generate or propagate a request/correlation ID for every request and include it in logs and error responses.

---

## 6. Errors, Logging, and Process Lifecycle

- Represent expected failures with typed application errors containing a stable machine-readable `code`, safe message, and HTTP status.
- Forward errors to one centralized Express error handler. Do not duplicate `try/catch` blocks merely to rethrow the same error.
- Map Prisma, Zod, authentication, and rate-limit errors to stable application errors in centralized adapters/middleware.
- Log once at the appropriate boundary with request ID and relevant non-sensitive context.
- Never use `console.log` in application code. Use the shared Pino logger.
- Redact authorization headers, cookies, passwords, tokens, secrets, and sensitive personal data.
- Handle `SIGTERM` and `SIGINT`: stop accepting traffic, finish active work within a timeout, disconnect Prisma and Redis, flush logs, then exit.
- Treat `uncaughtException` and unhandled promise rejection as fatal after logging and attempting graceful cleanup.

---

## 7. PostgreSQL and Data Modeling

- Use UUIDv7 identifiers generated in the application for standalone entity primary keys. Centralize ID generation in a shared utility.
- Tables and columns use `snake_case`; map Prisma model fields explicitly where needed.
- Entity/transaction tables should include:
  - `id`
  - `created_at`, `updated_at`
  - nullable `deleted_at` when soft deletion is required
  - nullable `created_by`, `updated_by`, `deleted_by` when user auditing applies
- Use explicit foreign keys, indexes, uniqueness constraints, and deletion behavior. Do not rely only on application validation for data integrity.
- Use database transactions for multi-write use cases and any operation that must be atomic. Keep transactions short and do not perform slow network calls inside them.
- Avoid N+1 queries, unbounded reads, and selecting unused sensitive columns. Paginate list endpoints.
- Use parameterized ORM queries. Any raw SQL requires a clear justification, bound parameters, and focused tests.
- Prisma models are persistence types, not API contracts. Map records to response DTOs; never expose password hashes or internal fields.
- Implement soft-delete filtering consistently in repository/query helpers where soft deletion is used.
- Seeders must be deterministic and idempotent where practical. Production seed execution must be explicit.

### Database Safety — Critical

- **NEVER** run destructive or data-resetting commands without the user's explicit approval immediately before execution.
- This includes dropping/truncating tables, resetting databases, deleting volumes, destructive migration resets, `prisma migrate reset`, or restoring a backup over an existing database.
- Treat every local database as persistent real data.
- Before an approved destructive operation, display and verify the resolved host, database name, and environment.
- Tests must use a dedicated isolated test database. Never point tests at development or production databases.
- Prefer testing migrations against an ephemeral PostgreSQL container/database rather than SQLite, because production uses PostgreSQL.

---

## 8. Redis Standards

- Access Redis through one infrastructure module with explicit connection lifecycle and typed helper functions.
- Prefix keys with application, environment, and domain, for example `starter-kit:dev:auth:session:<id>`.
- Every cache key must have an intentional TTL unless it represents documented persistent coordination state.
- Cache-aside operations must define invalidation behavior. Invalidate or update related keys after successful database commits.
- Redis failures must not corrupt PostgreSQL state. Decide per feature whether to fail closed, fail open, or degrade gracefully, and test that behavior.
- Do not store authoritative business records only in Redis.
- Use atomic Redis operations or Lua scripts for concurrency-sensitive changes; avoid read-modify-write races.
- Never use expensive key scans such as `KEYS` in production request paths; use `SCAN` only for controlled maintenance.

---

## 9. Authentication, Authorization, and Security

- Hash passwords with Argon2id using reviewed parameters. Never encrypt or log plaintext passwords.
- Keep access tokens short-lived. If refresh tokens are used, rotate them, store only a hash or opaque session identifier, support revocation, and detect reuse where practical.
- Authentication verifies identity; authorization is enforced separately through RBAC permissions close to the protected use case.
- Deny by default. Do not trust role or permission claims indefinitely when server-side revocation is required.
- Apply security headers with Helmet and configure CORS from an explicit allowlist. Do not use permissive production defaults.
- Apply rate limits at least to authentication, password reset, and other abuse-prone endpoints. Use Redis-backed limits when multiple instances run.
- Configure explicit request body size limits and safe proxy trust settings.
- Prevent mass assignment by constructing persistence inputs from validated fields only.
- Do not expose whether an account exists in login, forgot-password, or similar sensitive flows.
- Use cryptographically secure randomness for tokens. Store token digests when plaintext recovery is unnecessary.
- Validate uploaded file size, MIME signature, extension, and storage path. Never trust the original filename.
- Regularly audit dependencies, but do not apply breaking or major updates automatically.

---

## 10. OpenAPI and Swagger Documentation

- OpenAPI 3.1 documentation is part of the feature definition, not an afterthought.
- Serve Swagger UI at `/docs` outside production by default. If production docs are enabled, protect them appropriately.
- Serve the machine-readable specification at `/docs/openapi.json`.
- Define API title, version, server URLs, security schemes, common responses, pagination, and reusable schemas centrally.
- Every public endpoint must document:
  - summary, description, operation ID, and tags
  - authentication and required permissions
  - path/query/header parameters
  - request body schema and examples
  - every expected success and error status
  - response schemas and representative examples
- Keep runtime validation and OpenAPI generated from shared Zod schemas to prevent drift.
- Operation IDs must be stable and unique.
- CI must generate and validate the OpenAPI document. Broken or undocumented routes fail validation.
- When an endpoint contract changes, update schemas, examples, tests, and documentation in the same change.

---

## 11. Testing Strategy

- Tests must be deterministic, independent, and safe to run repeatedly.
- Use:
  - **unit tests** for pure domain logic and utilities
  - **integration tests** for repositories, PostgreSQL, Redis, and adapters
  - **HTTP/e2e tests** with Supertest against the Express `app` without binding a public port
- Test success paths, validation failures, authorization failures, conflicts, not-found cases, and unexpected dependency failures.
- Add regression tests before or with each bug fix.
- Do not mock the unit under test. Mock only boundaries that would make the test slow, nondeterministic, unsafe, or externally dependent.
- Integration tests must use isolated PostgreSQL and Redis instances/databases with cleanup that cannot target development data.
- Keep `app.ts` side-effect-light so tests can import it without starting the server.
- Coverage is a signal, not the goal; prioritize meaningful assertions around critical behavior.

---

## 12. Background Jobs and Idempotency

- Move slow or retryable work such as email, report generation, and third-party synchronization out of HTTP request paths.
- Job payloads must be versionable, minimal, validated, and free of secrets.
- Jobs must be idempotent or use an explicit deduplication/idempotency key.
- Configure bounded retries with exponential backoff and dead-letter handling. Never retry permanent validation errors indefinitely.
- Log job ID, attempt, duration, and final outcome with sensitive fields redacted.
- For database changes followed by job/event publication, use a transactional outbox pattern when delivery consistency matters.

---

## 13. Scripts, Containers, and CI

Maintain clear npm scripts for at least:

- `dev` — development server with reload
- `build` — compile production artifacts
- `start` — run compiled application
- `typecheck` — TypeScript checks without emit
- `lint` and `lint:fix`
- `format` and `format:check`
- `test`, `test:watch`, and `test:coverage`
- `db:migrate`, `db:deploy`, `db:generate`, and `db:seed`
- `openapi:generate` and `openapi:validate`
- `validate` — minimum full local quality gate

Container and deployment rules:

- Pin major service image versions and use health checks for PostgreSQL and Redis.
- Use a multi-stage, non-root production image with only runtime dependencies and compiled output.
- Include a `.dockerignore`; never bake `.env` or development secrets into images.
- Do not publish database or Redis ports in production deployment definitions.
- Run schema migrations as an explicit deployment step, not concurrently from every application replica.
- CI should install with `npm ci`, then run formatting checks, lint, typecheck, tests, build, and OpenAPI validation.

---

## 14. Git and Change Discipline

- Keep changes focused on the requested task. Do not refactor unrelated code or reformat the whole repository.
- Do not edit generated Prisma client code, build output, coverage output, or generated OpenAPI artifacts unless the repository intentionally commits a generated specification.
- Never commit secrets, logs, local volumes, IDE state, or temporary files.
- Add or update tests and OpenAPI documentation with behavior changes.
- Preserve backward compatibility unless a breaking change is explicitly requested and documented.
- Do not bypass lint, tests, hooks, or type checks to make a change appear successful.

---

## 15. AI Development Workflow and Definition of Done

Before modifying code:

1. Read the relevant route, schema, service, repository, tests, Prisma model, and OpenAPI definitions.
2. Confirm existing conventions before adding a new pattern or dependency.
3. Identify security, data migration, compatibility, and Redis invalidation implications.

Before marking work complete:

1. Ensure inputs are validated and outputs do not leak internal or sensitive fields.
2. Ensure authorization is enforced and mutating multi-write operations are transactional.
3. Update Prisma migrations, tests, `.env.example`, and OpenAPI documentation when relevant.
4. Run the smallest relevant checks during iteration.
5. Run the repository's full `npm run validate` quality gate for broad changes when available.
6. Report exactly which checks were run and their outcomes. Never claim unexecuted validation passed.
7. Mention any remaining risk, manual step, migration requirement, or follow-up explicitly.

If a requested action risks data loss, exposes secrets, weakens security, or conflicts with these rules, stop and ask for explicit confirmation or clarification.
