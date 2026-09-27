# Authorization

## Overview

The API uses database-backed role-based access control (RBAC) modeled after the Laravel Starter Kit. Authentication establishes the current user and session; authorization separately checks whether one of that user's current roles grants the exact permission required by the route.

Permissions are never embedded in the access JWT. Every protected request queries the current PostgreSQL assignments, so role or permission changes take effect on the next request without waiting for the access token to expire.

## Data model

```text
users -> user_roles -> roles -> role_permissions -> routes
```

- `roles` stores role codes and display names. Seeded examples are `SA`, `ADM`, and `USR`.
- `routes` is the permission catalog. Its `name` column contains stable permission names such as `user.index` or `file.store`.
- `user_roles` assigns one or more roles to a user.
- `role_permissions` grants catalog permissions to a role.
- Soft-deleted roles and permission routes never authorize a request.

There are no direct user-permission grants. A permission must be granted through a role. Any one matching role is sufficient.

## Permission semantics

Authorization uses an exact, case-sensitive permission-name match:

- `user.index` grants only `user.index`;
- `user.*` is not a wildcard;
- `user.index.extra` does not grant `user.index`;
- multiple roles are combined with OR semantics;
- a role named `Super Admin` has no implicit bypass.

The deterministic seed grants every seeded permission to the `SA` role explicitly. Removing one of those grants removes that capability from Super Admin users immediately.

Role names are included in login, refresh, and `/api/v1/auth/me` responses for UI display. They are not an authorization source for the frontend or backend. The backend permission query remains authoritative.

## Protected route map

| HTTP method | Path                            | Required permission |
| ----------- | ------------------------------- | ------------------- |
| `GET`       | `/api/v1/users`                 | `user.index`        |
| `GET`       | `/api/v1/users/export`          | `user.index`        |
| `GET`       | `/api/v1/users/import/template` | `user.create`       |
| `POST`      | `/api/v1/users`                 | `user.store`        |
| `POST`      | `/api/v1/users/import`          | `user.store`        |
| `GET`       | `/api/v1/users/:id`             | `user.index`        |
| `PATCH`     | `/api/v1/users/:id`             | `user.update`       |
| `DELETE`    | `/api/v1/users/:id`             | `user.destroy`      |
| `GET`       | `/api/v1/files`                 | `file.index`        |
| `POST`      | `/api/v1/files`                 | `file.store`        |
| `GET`       | `/api/v1/files/:id`             | `file.show`         |
| `GET`       | `/api/v1/files/:id/download`    | `file.download`     |
| `DELETE`    | `/api/v1/files/:id`             | `file.destroy`      |

`user.edit` exists in the seeded catalog for parity with Laravel-style UI capabilities, but no current API endpoint requires it.

## Middleware order

Protected routes use this order:

```text
Bearer JWT -> Redis session validation -> permission -> upload/validation -> controller
```

Missing, invalid, expired, or revoked authentication returns `401`. An authenticated user without the required grant receives the standard `403` response.

To protect a new route, add the permission to the catalog/migration or seed as appropriate and wire the middleware with its exact stable name. Do not authorize by checking the role names returned to a client.

## Seed behavior

`prisma/seed.ts` is deterministic and additive:

- it upserts the `SA`, `ADM`, and `USR` roles;
- it upserts the current user/file permission catalog;
- it restores soft-deleted seeded roles/routes;
- it explicitly grants all seeded permissions to `SA`;
- it does not create users, assign roles to users, delete custom data, or provide a runtime bypass.

Assign the initial `SA` role to an existing administrator through a reviewed administrative process or explicit database operation appropriate to the deployment. Do not put credentials or user-specific production assignments in the seed.

## Deployment

The RBAC migration and seed are never run automatically by application startup.

1. Back up and verify the target PostgreSQL database.
2. Review `prisma/migrations/20260923000000_add_rbac/migration.sql`.
3. Apply committed migrations through the normal deployment migration step.
4. Run the seed explicitly if the deployment should install/update the standard catalog and Super Admin grants.
5. Assign roles to users through an approved process.
6. Verify representative endpoints with an authenticated user that has and lacks the required grants.

Never run migration reset, drop, truncate, or destructive restore operations as part of this process.
