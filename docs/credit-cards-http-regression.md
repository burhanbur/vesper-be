# Credit-card HTTP regression

## Scope

`tests/integration/credit-cards-http.integration.test.ts` uses Supertest against existing account, transaction, transfer and sync routers, with real services, Prisma repositories and isolated PostgreSQL. No production endpoint is added.

The test mirrors `createApp` repository injection, including `syncClient` publication. It deliberately composes only the relevant routers and centralized error handler rather than importing the full application and its default Prisma/Redis clients. Other HTTP fixtures under `tests/e2e` use `createApp` with fake repositories; this regression must retain real persistence.

Only the external Redis session boundary is replaced by the established `FakeAuthSessionStore`. Fixture registration uses the real auth service and PostgreSQL auth repository, and requests use a signed Bearer token; an unauthenticated request is also rejected. This is **not real auth/Redis integration**, an HTTP login/refresh lifecycle test, full application middleware coverage, or mobile UI/outbox execution. Test configuration is mocked to avoid loading `.env` or constructing development infrastructure clients.

## Assertions

- HTTP creation returns zero balance and exact fractional contractual limit `1000000.23`.
- Existing HTTP EXPENSE and bank-to-card TRANSFER endpoints produce card balances `-2000000.00`, `500000.00`, `300000.00`, then `-100000.00`.
- HTTP account reads verify the unchanged limit and exact balances of both card and bank at every stage. Spending beyond the advisory limit and consuming an overpayment remain allowed.
- Existing sync push accepts client-generated account, purchase, repayment and subsequent expense IDs, including an untracked null limit.
- Replaying the offline transfer adds neither ledger rows nor sync changes and changes neither account balance.
- Compact HTTP pull includes authoritative account metadata and exact paired TRANSFER amounts, with no push-only transfer command entity. Version strings are ordered and bounded by the watermark; compact entities are unique.
- Repeating the same pull cursor returns identical data; advancing to `next_version` returns no changes.

## Isolation and actual verification — 2026-11-07

Before execution, `scripts/test-postgres-integration.ts`, `compose.integration.yml` and the integration Vitest configuration were inspected. The harness creates a randomly named Compose project, validates its isolation label, tmpfs data storage and loopback-only ephemeral port, and applies migrations only to that fresh database. The test also verifies the actual database and user. No development database fallback is used.

Results for this follow-up:

- `npm run typecheck`: passed.
- `npm run test:integration:postgres`: **15 files / 70 tests passed**, including the HTTP regression.
- Focused Prettier check and ESLint for the HTTP test: passed.
- The existing non-fatal `pg` concurrent-query deprecation warnings remain.

The isolated run used project `vesper-it-11df04b9-cde7-4e95-8a91-424cfbcff805`, PostgreSQL at `127.0.0.1:52485`, database `vesper_integration_test`, user `vesper_integration`. Its 28 migrations ran only in fresh tmpfs storage, not a persistent database. No cleanup, reset, deployment or persistent migration was performed. The container is intentionally retained by harness policy; stopping/removing it requires separate approval.

The HTTP test already existed as an untracked working-tree file at handoff. This follow-up preserved it and strengthened its HTTP balance, replay and cursor assertions. The repository-only credit-card test and unrelated dirty files were not edited.
