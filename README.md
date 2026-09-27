# Express Starter Kit

Production-ready backend starter kit for Express 5, Node.js 22, TypeScript, PostgreSQL, Redis, Prisma, Zod, and OpenAPI 3.1.

## Features

- Strict TypeScript with native ESM and NodeNext resolution
- Modular route → validation → controller → service → repository architecture
- PostgreSQL through Prisma with committed migrations and application-generated UUIDv7 IDs
- Redis through `ioredis` with explicit lifecycle management
- Zod request validation and shared OpenAPI schemas
- Swagger UI and machine-readable OpenAPI document
- Laravel Starter Kit-compatible JSON response contracts
- Pino structured logging, request IDs, centralized errors, Helmet, allowlist CORS, and rate limiting
- Bearer access/refresh JWT authentication with exact Redis token registration, atomic rotation, replay revocation, and independent multi-device sessions
- Live database-backed RBAC with exact named permissions, multi-role grants, and immediate revocation
- Liveness/readiness checks and graceful shutdown
- Vitest and Supertest with injected fake boundaries
- Streaming XLSX export and bounded, validated XLSX user import
- File manager with signature validation, SHA-256 checksums, PostgreSQL metadata, and replaceable storage adapters
- Docker Compose, multi-stage production image, and GitHub Actions CI

## Requirements

- Node.js 22 LTS
- npm 10+
- Docker with Docker Compose for local PostgreSQL and Redis, or equivalent services

## Quick Start

1. Install dependencies:

   `npm install`

2. Create local environment configuration:

   `cp .env.example .env`

3. Replace the example access-JWT and refresh-JWT secrets with different strong values, then adjust service URLs.

4. Start PostgreSQL and Redis:

   `docker compose up -d postgres redis`

5. Generate the Prisma client:

   `npm run db:generate`

6. Review the resolved `DATABASE_URL`, then apply the committed migration:

   `npm run db:migrate`

7. Start development mode:

   `npm run dev`

The API listens at `http://localhost:3000` by default.

> Database safety: never run `prisma migrate reset`, drop/truncate data, remove database volumes, or restore over an existing database without explicit approval and verification of the resolved host/database/environment.

## Beginner Development Guide

New to this backend or its technology stack? Read [`docs/development-guide.md`](docs/development-guide.md). It explains the project structure, request flow, local setup, module development workflow, database and Redis usage, testing, debugging, deployment, common mistakes, and the pull request checklist.

> Edit source files under `src/`, not generated build output under `dist/`. For example, edit `src/server.ts` instead of `dist/server.js`.

## API Documentation

When `API_DOCS_ENABLED=true` and `NODE_ENV` is not `production`:

- Swagger UI: `GET /docs`
- OpenAPI JSON: `GET /docs/openapi.json`

Generate a static local artifact with `npm run openapi:generate`. Validate the document with `npm run openapi:validate`.

## API Response Contract

Responses intentionally match `app/Traits/ApiResponse.php` from the Laravel Starter Kit.

### Success

```json
{
  "success": true,
  "message": "Data pengguna berhasil diambil.",
  "timestamp": "2026-09-20 10:11:12",
  "total_data": 1,
  "data": {
    "id": "01995f6c-607b-7000-8000-000000000001",
    "name": "Budi Santoso",
    "email": "budi@example.com",
    "status": "ACTIVE",
    "created_at": "2026-09-20T10:11:12.000Z",
    "updated_at": "2026-09-20T10:11:12.000Z"
  },
  "debug": {
    "url": "http://localhost:3000/api/v1/users/01995f6c-607b-7000-8000-000000000001",
    "method": "GET"
  }
}
```

`total_data` is `0` for null, the array length for collections, and `1` for a single object. `debug` is omitted in production.

### Paginated Success

```json
{
  "success": true,
  "message": "Data pengguna berhasil diambil.",
  "timestamp": "2026-09-20 10:11:12",
  "total_data": 2,
  "data": [],
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

As in Laravel, `total_data` is the number of items in the current response page; `pagination.total` is the full matching count.

### Error

```json
{
  "success": false,
  "message": "Validasi gagal. Silakan periksa kembali input Anda.",
  "timestamp": "2026-09-20 10:11:12",
  "errors": {
    "body": {}
  },
  "debug": {
    "url": "http://localhost:3000/api/v1/users",
    "method": "POST",
    "original_message": "Validasi gagal. Silakan periksa kembali input Anda."
  }
}
```

`errors` is optional. `debug` is included only outside production. Request IDs are propagated in the `X-Request-Id` header and logs without changing the established body contract.

## Endpoints

| Method   | Path                            | Purpose                                      |
| -------- | ------------------------------- | -------------------------------------------- |
| `GET`    | `/health/live`                  | Process liveness                             |
| `GET`    | `/health/ready`                 | PostgreSQL and Redis readiness               |
| `POST`   | `/api/v1/auth/login`            | Login by username/email; return both JWTs    |
| `POST`   | `/api/v1/auth/refresh`          | Atomically rotate both Redis-registered JWTs |
| `POST`   | `/api/v1/auth/logout`           | Revoke only the current Bearer-token session |
| `GET`    | `/api/v1/auth/me`               | Get authenticated user                       |
| `GET`    | `/api/v1/users`                 | Paginated user list                          |
| `POST`   | `/api/v1/users`                 | Create user                                  |
| `GET`    | `/api/v1/users/export`          | Stream users as XLSX                         |
| `GET`    | `/api/v1/users/import/template` | Download XLSX import template                |
| `POST`   | `/api/v1/users/import`          | Validate and import XLSX users               |
| `GET`    | `/api/v1/users/:id`             | Get user                                     |
| `PATCH`  | `/api/v1/users/:id`             | Update user                                  |
| `DELETE` | `/api/v1/users/:id`             | Soft-delete user                             |
| `GET`    | `/api/v1/files`                 | Paginated file metadata                      |
| `POST`   | `/api/v1/files`                 | Upload one validated file                    |
| `GET`    | `/api/v1/files/:id`             | Get file metadata                            |
| `GET`    | `/api/v1/files/:id/download`    | Stream the stored file                       |
| `DELETE` | `/api/v1/files/:id`             | Delete metadata and stored object            |

Both multipart endpoints use the field name `file`. Excel import is all-or-nothing: headers and every non-empty row are validated before any user is written. Binary success responses intentionally do not use the JSON envelope; failures still use the standard error envelope.

All users/files endpoints require an access JWT whose exact digest is registered in Redis and an exact RBAC permission provided via the `Authorization: Bearer <token>` header. See [`docs/authorization.md`](docs/authorization.md) for the permission map, role semantics, seed behavior, and deployment steps.

## Authentication

Login accepts username/password or email/password and returns access and refresh JWTs in JSON. Each login creates an independent Redis session, so one user can remain signed in on multiple devices. Protected requests verify the access JWT and its exact Redis digest before loading current user and role data from PostgreSQL.

Refresh accepts `{ "refresh_token": "..." }` and atomically rotates both JWT digests. Replay revokes only the affected session. Logout requires the access Bearer token and also revokes only that session. Authentication uses no cookies or CSRF tokens.

Frontend clients should implement one shared/single-flight refresh operation, replace both tokens after refresh, retry eligible failed requests once, and never recursively refresh login, refresh, or logout requests. See [`docs/authentication.md`](docs/authentication.md) for complete details.

## Excel Import and Export

1. Download `GET /api/v1/users/import/template`.
2. Keep the exact columns `name`, `email`, `password`, and `status`.
3. Upload the workbook as multipart field `file` to `POST /api/v1/users/import`.
4. Correct any row-keyed errors such as `rows.2`, then retry the complete file.

Passwords are hashed with Argon2id and never exported. Export uses cursor-batched database reads and an XLSX streaming writer. Import is bounded by `EXCEL_IMPORT_MAX_BYTES` and `EXCEL_IMPORT_MAX_ROWS`.

## File Storage

`StoredFile` metadata lives in PostgreSQL; binary content lives behind the `FileStorage` interface. The default `LocalFileStorage` writes under `FILE_STORAGE_PATH` using generated keys rather than original filenames. Uploads are bounded, signature-detected, extension-checked, MIME-allowlisted, and SHA-256 checksummed.

Local storage is suitable for one persistent instance. Mount `FILE_STORAGE_PATH` to a persistent volume in containers. For multiple replicas, implement the same `FileStorage` interface with S3-compatible object storage and inject it in `src/app.ts`. Protect upload/download/delete routes with product-specific authentication and authorization.

The committed `StoredFile` migration must be reviewed and applied explicitly with the normal deployment migration step. It was not designed to run automatically at application startup.

## Architecture

```text
src/
├── app.ts
├── server.ts
├── config/
├── infrastructure/
│   ├── cache/
│   ├── database/
│   └── storage/
├── common/
│   ├── contracts/
│   ├── errors/
│   ├── http/
│   ├── middleware/
│   └── utils/
├── docs/
└── modules/
    ├── auth/
    ├── files/
    ├── health/
    └── users/
```

- `app.ts` composes Express without opening a network port, enabling Supertest usage.
- `server.ts` owns process startup, signal handling, and resource cleanup.
- Runtime request validation and OpenAPI use the same Zod contracts.
- Controllers only translate HTTP concerns; services own use cases; repositories own persistence.

## Environment Variables

All environment variables are validated on startup in `src/config/env.ts`. See `.env.example` for the complete list.

- `DATABASE_URL` and `REDIS_URL`: infrastructure connections
- `CORS_ORIGINS`: comma-separated explicit allowlist
- `TRUST_PROXY`: enable only when the deployment proxy topology is understood
- `BODY_LIMIT_BYTES`: maximum JSON/form request body size
- `HTTP_*_TIMEOUT_MS`: HTTP request, header, and keep-alive timeout controls
- `SHUTDOWN_TIMEOUT_MS`: maximum graceful shutdown duration
- `EXCEL_IMPORT_MAX_BYTES`, `EXCEL_IMPORT_MAX_ROWS`, `EXCEL_EXPORT_BATCH_SIZE`: XLSX resource limits
- `FILE_STORAGE_PATH`: local binary storage root; mount it as persistent storage in containers
- `FILE_UPLOAD_MAX_BYTES`: maximum size accepted by the multipart upload middleware
- `FILE_ALLOWED_MIME_TYPES`: comma-separated signature-verified MIME allowlist
- `API_DOCS_ENABLED`: controls docs outside production; production docs remain disabled by default
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `AUTH_JWT_*`: independent JWT signing secrets and claim constraints
- `AUTH_ACCESS_TTL_SECONDS`, `AUTH_REFRESH_TOKEN_TTL_SECONDS`: access and refresh JWT durations
- `AUTH_*_RATE_LIMIT_*`: process-local login and refresh abuse limits

Application modules must import typed configuration and must not read `process.env` directly.

## Scripts

| Script                     | Purpose                                  |
| -------------------------- | ---------------------------------------- |
| `npm run dev`              | Development server with reload           |
| `npm run build`            | Compile production output                |
| `npm start`                | Run compiled server                      |
| `npm run typecheck`        | TypeScript validation without emit       |
| `npm run lint`             | ESLint checks                            |
| `npm run format:check`     | Prettier verification                    |
| `npm test`                 | Unit and HTTP tests                      |
| `npm run test:coverage`    | Coverage report                          |
| `npm run audit:production` | Audit production dependencies            |
| `npm run db:generate`      | Generate Prisma Client                   |
| `npm run db:migrate`       | Create/apply development migration       |
| `npm run db:deploy`        | Apply committed migrations in deployment |
| `npm run db:seed`          | Run deterministic seed entry point       |
| `npm run openapi:generate` | Write `generated/openapi.json`           |
| `npm run openapi:validate` | Validate OpenAPI 3.1 document            |
| `npm run validate`         | Full local quality gate                  |

## Testing

Basic unit and HTTP tests use dependency injection and do not connect to PostgreSQL or Redis. Repository integration tests should use dedicated ephemeral PostgreSQL and Redis instances with a test-only URL. Never point tests at development or production databases.

Run `npm test` for fast validation or `npm run validate` before broad changes.

## Production Notes

- Build the multi-stage `Dockerfile`; it runs as a non-root user.
- Run `npm run db:deploy` as an explicit deployment step, not in every application replica.
- Configure HTTPS, explicit CORS origins, trusted proxies, strong independent authentication secrets, and structured log shipping.
- Use shared Redis for authentication sessions and a shared rate-limit store when running multiple replicas.
- Apply the committed authentication migration explicitly before enabling authentication traffic.
- Use persistent local storage for one instance or an S3-compatible `FileStorage` adapter for multiple replicas.
- Apply the committed RBAC migration, run the deterministic permission seed explicitly, and assign roles through an approved process before enabling management traffic.
- The production process treats uncaught exceptions and unhandled rejections as fatal and attempts graceful cleanup.

## License

MIT
