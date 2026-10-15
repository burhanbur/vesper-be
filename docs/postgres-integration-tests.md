# Isolated PostgreSQL transfer regression tests

## Run

From `/home/bmafazi/code/personal/vesper-be` in WSL, run `npm run test:integration:postgres`.
Requires Node.js 22+, installed npm dependencies/generated Prisma client, Docker with a reachable daemon, Compose v2 supporting `up --wait`, and the PostgreSQL 17 Alpine image (or permission to pull it).

The opt-in command starts a new randomly named Compose project using **only** `compose.integration.yml`. It ignores Compose `.env` interpolation with `--env-file /dev/null`, uses PostgreSQL tmpfs storage, and publishes an ephemeral port on `127.0.0.1` only. It verifies the project label and tmpfs before deploying committed migrations. It never uses the development Compose configuration, database URL, seed, or volumes. The fixed password in the fixture is public test-only data, not an application credential.

The dedicated `prisma.integration.config.ts` does not import dotenv. Both migrations and tests validate the explicit test opt-in, test environment, loopback hostname, nondefault port, dedicated database and role. There is no fallback to `DATABASE_URL`. Ordinary `npm test` excludes these tests, and the integration Vitest config does not load `tests/setup.ts` (which overrides the normal test database URL).

No reset, drop, truncate, deleteMany, database cleanup, container stop/down, or volume deletion is performed. Failed tests retain their rows for inspection; each fixture has fresh UUIDs and assertions scope to that fixture. Each invocation uses a fresh container. **Containers intentionally remain running**, including on failure; the runner prints the unique project name. Stopping a tmpfs container loses its test data. Review its identity and obtain explicit approval before manual removal; never reuse development cleanup commands.

## Coverage

Real Prisma repositories and PostgreSQL locks/constraints, with no mocked ledger or database:

- Concurrent identical offline repository commands: one parent, two exact client-ID signed legs, one balance/version change.
- Concurrent opposite-direction distinct commands: deterministic locking and no lost balance updates.
- Equivalent-decimal replay with unchanged persisted rows, timestamps, versions and events.
- Changed amount/leg-ID collisions rejected without mutation.
- Duplicate leg primary key failure rolls back a parent inserted earlier in the transaction.
- Account-version exhaustion on the final sorted account rolls back both legs, the parent, an earlier account update and all publication.
- Concurrent sync replay from two devices publishes accounts and signed ledger legs once; pull returns the legs; subsequent replay adds no events.

Investment coverage also verifies exact BUY/SELL cash settlement, oversell rejection, chronological locking, durable UUID replay across devices, revoked cash access, ledger collision/version-exhaustion rollback, and independent portfolio/cash authorization. Sharing only the investment account publishes a portfolio CREATE without exposing its cash ledger; deleting that share by ID publishes a DELETE tombstone to the former recipient.

Publication is exercised through real `SyncRepository.apply` and `syncClient` transactions. PostgreSQL sequence gaps after rollback are allowed; assertions compare persisted events rather than assuming contiguous sequence numbers. No Redis is needed for these repository tests. HTTP authorization and Redis delivery remain outside this focused suite.

The container uses Docker's built-in bridge network because no service discovery is required. Retained test projects therefore do not allocate a new subnet per run. Setup errors are printed to stderr without printing database URLs. The latest focused run passed 16 integration tests (10 investment and 6 transfer), including deployment of all 20 committed migrations into the isolated database.

## Safety gates

Internal runner variables are `NODE_ENV=test`, `VESPER_POSTGRES_INTEGRATION=ephemeral-postgres-only` and `VESPER_INTEGRATION_DATABASE_URL`. They are constructed by the runner; do not populate an application `.env` or substitute a development database. Direct use of the integration Vitest/Prisma configs without these gates fails closed. The runner additionally proves container ownership before migration; use the npm command rather than manually forging the internal gates.
