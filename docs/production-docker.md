# Production Docker deployment (Ubuntu + Apache)

## Topology

Apache runs on the Ubuntu host. Only Apache exposes public HTTP/HTTPS ports. The API is published at `127.0.0.1:3000`, the frontend at `127.0.0.1:5173`. PostgreSQL is installed on Ubuntu; Redis runs in Compose without published ports. Current Dockerfiles use Node.js 24; the application minimum remains Node.js 22.

## Backend environment

Create the ignored `.env.production` from `.env.example` locally on the server. Use `NODE_ENV=production`, `LOG_LEVEL=info`, `API_DOCS_ENABLED=false`, and `CORS_ORIGINS=https://vesper.sprigan.my.id`. Set two different cryptographically random JWT secrets (at least 32 characters each); never retain example values. Rotate any database password that has been shared. Restrict file permissions to the deployment account (`chmod 600 .env.production`). Never commit this file.

Use a URL-encoded password in `DATABASE_URL` with hostname `host.docker.internal`, port `5432`, and your actual database name. Compose maps that hostname to the Ubuntu host. Do not use `localhost` inside the API container. Compose overrides the runtime Redis URL to `redis://redis:6379` and configures one trusted proxy hop. Local `.env` can remain unchanged for non-Docker development.

### PostgreSQL host access

The host alias alone does not enable PostgreSQL access. Inspect the actual PostgreSQL configuration and Docker network first; do not guess the subnet. Locate configuration with `SHOW config_file`, `SHOW hba_file`, and `SHOW listen_addresses` in an administrator PostgreSQL session. Inspect the Compose network subnet and the container's resolved `host.docker.internal` address.

Configure PostgreSQL to listen on localhost and the reachable Docker host address. Add a narrowly scoped `pg_hba.conf` rule for the application database, dedicated application role, and actual Docker client subnet using `scram-sha-256`. Permit that traffic through the host firewall but never expose PostgreSQL port 5432 publicly. A `listen_addresses` change requires a PostgreSQL restart: schedule it if the database is in use. Do not reset, recreate, or drop the existing database.

## Build and migrations

From `vesper-be`:

```sh
docker compose build api migrate
```

Back up the database and review pending migrations before applying them. The dedicated migration image contains Prisma CLI and migrations; the runtime API image intentionally does not. Run migrations once per release, not concurrently in every API replica:

```sh
docker compose --profile tools run --rm --no-deps migrate
```

This targets the database in `.env.production`. Never use `prisma migrate reset`, `migrate dev`, or `docker compose down -v` for deployment.

After successful migrations:

```sh
docker compose up -d api redis
docker compose ps
curl --fail http://127.0.0.1:3000/health/ready
```

Health checks report dependency readiness but do not automatically restart an unhealthy running process. Redis and upload volumes survive container replacement. A newly created Compose Redis volume does not automatically contain sessions from a previous Redis installation.

## Apache virtual hosts and TLS

Use the frontend example in `vesper-web/docker/apache/vesper.conf` and the backend example in `docker/apache/api-vesper.conf`. Both are initial HTTP virtual hosts. Edit existing virtual hosts for these domains rather than enabling duplicate `ServerName` entries.

Enable `proxy`, `proxy_http`, `headers`, and `ssl` modules. Validate with `apache2ctl configtest` before reloading Apache. After DNS is correct and ports 80/443 are reachable, obtain HTTPS certificates with Certbot's Apache plugin and enable HTTP-to-HTTPS redirects for both domains. Confirm the generated TLS virtual hosts retain the proxy and forwarded-header configuration. Set `X-Forwarded-Proto` to `https` in the TLS API virtual host (the HTTP example uses `http`).

The API Compose configuration uses `TRUST_PROXY=1`, which is safe only for this fixed single-proxy topology with no direct public access to the backend. Apache must discard incoming forwarding headers and construct its own. If a CDN/load balancer is added, review the complete trust chain; do not increase the hop count blindly. Rate limits must distinguish real clients.

## Verification

Verify HTTPS, `/health/ready`, CORS, login, session restoration, refresh rotation, logout, uploads, and direct frontend routes. Check certificate renewal. Configure and test a restrictive CSP at the frontend HTTPS boundary before go-live; do not blindly apply a policy that breaks necessary application styles/connections. No production deployment or host PostgreSQL changes are performed by these repository files.
