# Authentication

## Contract

Authentication uses explicit access and refresh JWT credentials. Login accepts either `{ "username": "budi", "password": "..." }` or the backward-compatible `{ "email": "budi@example.com", "password": "..." }` body. Both tokens are returned in JSON; authentication does not use cookies or CSRF.

| Credential  | Delivery             | Usage                                                            |
| ----------- | -------------------- | ---------------------------------------------------------------- |
| Access JWT  | `data.access_token`  | Send as `Authorization: Bearer <token>` on protected requests    |
| Refresh JWT | `data.refresh_token` | Send as `{ "refresh_token": "<token>" }` to the refresh endpoint |

Each login creates a separate Redis session identified by the JWT `sid` claim. One user can therefore have multiple concurrently active devices or clients.

## Endpoint flow

1. `POST /api/v1/auth/login` verifies username/email and password, creates a Redis session, and returns the user, access JWT, refresh JWT, and both expiry timestamps with `Cache-Control: no-store`.
2. `GET /api/v1/auth/me` verifies the access JWT, checks that its exact SHA-256 digest is registered in Redis, and loads the current active user and roles from PostgreSQL.
3. `POST /api/v1/auth/refresh` verifies the refresh JWT and atomically rotates both registered token digests in Redis. The old access token becomes invalid immediately.
4. `POST /api/v1/auth/logout` requires the current Bearer access token and deletes only its Redis session. Other sessions for the same user remain active.
5. All protected resource routes execute the same JWT and Redis session validation middleware before authorization.

## Token and session security

- Access and refresh JWTs use separate secrets and only `HS256`.
- Verification validates issuer, audience, `typ=JWT`, `sub`, `sid`, `jti`, expiry, and `token_use`.
- Redis stores SHA-256 token digests, never raw JWT credentials.
- Redis keys use `auth:session:<userId>:<sessionId>` and expire with the refresh token.
- Refresh rotation is atomic through a Redis Lua script.
- Reuse of an old refresh token deletes only that session; unrelated sessions remain active.
- PostgreSQL remains authoritative for current user status and roles. An inactive or deleted user causes the relevant Redis session to be revoked.

## Frontend integration

1. Submit username/email and password to login and retain both returned tokens according to the frontend application's security policy.
2. Attach `Authorization: Bearer <access_token>` to every protected request.
3. On access-token expiry, perform one shared refresh request using `{ "refresh_token": "<refresh_token>" }`, replace both local tokens, and retry eligible requests once.
4. Never refresh login, refresh, or logout requests recursively.
5. On logout, call the endpoint with the current access Bearer token and remove both local tokens.
6. On refresh failure, clear authentication state and return to login.

Never write tokens to logs, analytics, URLs, or error messages. Prefer memory or platform-protected credential storage over browser `localStorage` when the client architecture permits it.

Authentication responses include current role names for UI display, but permissions are not stored in JWTs or trusted from the client. Users/files authorization performs a live database permission check. See [`authorization.md`](authorization.md).

## Deployment requirements

- Configure different strong values for `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` through a secret manager.
- Restrict `CORS_ORIGINS` to known frontend origins and terminate TLS safely.
- Redis must be shared by all application replicas so session validation and revocation are consistent.
- Apply the committed Prisma migration that adds optional unique usernames and removes the obsolete PostgreSQL auth-session tables.
- The built-in authentication rate limiters are process-local; use a shared Redis-compatible rate-limit store for multi-replica deployments.
