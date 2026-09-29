# College Attendance Platform

The production application is organized at the repository root:

```text
backend/       Express + TypeScript API and PostgreSQL access
frontend/      Existing React + Vite client
deploy/        Caddy and systemd configuration
docker-compose.yml
```


## Quick start

Requirements: Node 20+, pnpm 9+, and Docker (for local PostgreSQL).

```sh
cp .env.example backend/.env
docker compose up -d postgres
pnpm install
pnpm --dir backend db:migrate
pnpm --dir backend dev
pnpm --dir frontend dev
```

The frontend runs on `http://localhost:5173`; the API runs on
`http://localhost:4000`.

## D1 to PostgreSQL migration

The importer is read-only against the SQLite source and writes to PostgreSQL
inside one transaction. It is safe to re-run: existing identical rows are
skipped, while conflicting rows fail the transaction instead of being
silently overwritten.

After midnight, export the remote Cloudflare D1 database using the account's
configured D1 export process. The importer accepts either the resulting SQL
export or a SQLite database file:

Create a fresh PostgreSQL database and run a dry run:

```sh
pnpm --dir backend migrate:d1 -- \
  --source /path/to/d1-export.sql \
  --target "$DATABASE_URL" \
  --dry-run
```

Then import and verify:

```sh
pnpm --dir backend migrate:d1 -- \
  --source /path/to/exported-d1.sqlite \
  --target "$DATABASE_URL" \
  --report ./migration-report.json
```

The importer contains the D1-to-PostgreSQL table mapping and preserves every
current D1 business table, including cached attendance and engagement data.

## GitHub Actions deployment

The workflow at `.github/workflows/deploy-aws.yml` builds the existing React
frontend, builds the Express backend, uploads both artifacts over SSH, restarts
the systemd service, and reloads Caddy.

After refreshing GitHub CLI authentication, configure the repository secrets:

```sh
gh auth login -h github.com
gh secret set AWS_DEPLOY_HOST --body 13.233.147.195
gh secret set AWS_DEPLOY_USER --body ubuntu
gh secret set AWS_DEPLOY_SSH_KEY < ~/ssh-keys/fokat-ka-maal.pem
```

The production domain is configured in `deploy/Caddyfile` as
`attendance.himon.in`; Caddy provisions and renews HTTPS automatically.

## Debugging and request logs

The API emits one JSON log event for every response. It includes the request
ID, method, path, status, duration, and authentication state, but never logs
request bodies, cookies, tokens, or enrollment IDs. College portal and
attendance-cache events are also emitted at `debug` level.

On the server:

```sh
sudo journalctl -u college-attendance-api -f -o cat
sudo tail -f /var/log/caddy/college-attendance-access.log
```

Use `LOG_LEVEL=debug` temporarily for detailed portal/cache diagnostics;
`info` is the recommended steady-state level. Every API response includes its
`X-Request-Id`, which can be matched directly in the systemd journal.

Notification email uses AWS SES SMTP as the primary provider. If SES rejects
or cannot deliver a message, the API automatically retries that message
through Resend. SMTP credentials belong only in the server environment and
must never be committed.

Never commit `.env`, database dumps, migration reports, or credentials.
