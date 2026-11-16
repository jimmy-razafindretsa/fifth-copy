# Operations runbook

Short procedures for the operator of the Railway project (ADR 0019). Never paste a connection URL, password or
Railway credential into this file, an issue or a commit: the commands below read them from the environment.

One-time procedures: [region move from `sfo` to `us-east`](region-move.md) (#781).

## Import texts

The race text corpus lives in the `Text` table (`prisma/schema/texts.prisma`, #346). `startRace` reads it through
`loadCorpusProvider` and falls back to the committed content files while a language has fewer than 20 rows, so a
fresh database needs no import and a deploy needs no data step. Import when you add or edit content files
(`src/features/texts/corpus/content/{fr,en}/*.json`, format and licence rules in `docs/texts/teacher-texts.md`
and `docs/texts/sources.md`).

`scripts/import-texts.ts` checks every file through the content schema first: a file without `source` or
`licence`, or with a passage that is not typeable, stops the run (exit 1, the file is named, nothing is written).
Each passage is upserted by the sha256 of its content, so running it twice adds nothing. Running servers see new
rows within 5 minutes (provider cache).

Local (the card worktree or the main checkout, local Postgres from `npm run db:up`):
```
set -a; . ./.env; set +a
npx tsx scripts/import-texts.ts --validate   # files only, no database
scripts/db-guard.sh && npx tsx scripts/import-texts.ts
npx prisma db seed                           # the seed runs the same import
```
`--dir <folder>` imports another folder laid out as `<folder>/{fr,en}/*.json` (for example a reviewed teacher
submission) instead of the committed corpus.

Railway (production), from a shell logged in with `railway login` and linked to the project with `railway link`:
```
railway ssh --service web
# inside the web container (DATABASE_URL is the service's own variable):
DB_GUARD_ALLOWED_HOSTS=postgres.railway.internal npx tsx scripts/import-texts.ts --validate
DB_GUARD_ALLOWED_HOSTS=postgres.railway.internal npx tsx scripts/import-texts.ts
```
The import runs `scripts/db-guard.sh`, which refuses any host that is not local unless it is named in
`DB_GUARD_ALLOWED_HOSTS` for that one command; name only the Railway Postgres private host shown in the service's
variables. `railway run --service web <command>` from a local checkout works the same way when the variables it
injects point at a host your machine can reach (the public proxy host instead of the private one). The container
imports the files of the deployed commit: merge new content files first, then import.

## Stale deploy

The `deploy-check` workflow (`.github/workflows/deploy-check.yml`, #718) runs after every push to `main`. It reads the
public web `/api/health` and race-server `/health` every 30 s for up to 20 min and compares each service's `commit`
and `protocol` with `main` (`scripts/deploy-check.ts`). It needs the repository variables `WEB_PUBLIC_URL` and
`RACE_SERVER_PUBLIC_URL` (public URLs, not secrets: `gh variable set WEB_PUBLIC_URL --body <web URL>`).

**Read the red check.** Open the failed `deploy-check` run; the job summary lists one line per failing service:

- `STALE <service> deployed=<sha> expected=<sha>`: the service still runs `deployed`, older than the newest `main`
  commit that touches its watch paths (`expected`, ADR 0019). Usually a failed Railway build or a skipped deploy.
  `deployed=null` means the health endpoint did not answer or Railway gave no commit.
- `PROTOCOL <service> deployed=<n> main=<n>`: the service speaks another `PROTOCOL_VERSION` than `main`; web and
  race-server then reject each other's handshake (ADR 0006).

A service whose watch paths did not change keeps its older commit and stays green: Railway skipped it on purpose.
A missing repository variable fails the run with a line naming it.

**Redeploy by hand** (CI holds no Railway token and never redeploys):

1. Railway dashboard: project, the named service (`web` or `race-server`), Deployments. If the latest deployment
   failed, read its build log first and fix the cause on `main`.
2. Redeploy the deployment built from the newest `main` commit (its menu, Redeploy), or from a shell already
   logged in to Railway: `railway redeploy --service <web|race-server>`.
3. Wait until Railway marks the deployment Active and its healthcheck passes.

**Confirm.** Actions, `deploy-check`, Run workflow on `main` (`workflow_dispatch`, or
`gh workflow run deploy-check.yml --ref main`). The run goes green with an `OK` line.

## Site down

The `uptime` workflow (`.github/workflows/uptime.yml`, #423) runs every 15 min. It runs `scripts/deploy-smoke.sh`
against the public web URL (`/api/health`, `/`, a 404 probe) and, through `RACE_SMOKE_URL`, the race server's
`/health`. A failed run is retried 3 times, 20 s apart, before it goes red. It reads the same repository variables as
`deploy-check` (`WEB_PUBLIC_URL`, `RACE_SERVER_PUBLIC_URL`); a missing one fails the run with a line naming it.

**Alert.** GitHub emails the owner about a failed scheduled run when the account's notification settings have
Actions, "Send notifications for failed workflows only" on (Settings, Notifications, System, Actions). Scheduled
runs notify the user who last edited the cron line in `uptime.yml`, so keep that the owner.

**Read the red run.** Open the failed `uptime` run; the job summary shows the last attempt, one line per probe:

- `FAIL health: GET /api/health -> 000`: the web service does not answer at all.
- `FAIL health: GET /api/health -> 503`: web runs but cannot reach Postgres (its body reads `"db":"down"`).
- `FAIL home` / `FAIL not-found` with a healthy `/api/health`: web answers but renders errors; read the web logs.
- `FAIL race-health: GET /health -> 503`: the race server is draining (#704). That is expected for a minute during a
  deploy; a red run means it stayed draining across all 3 attempts, so the new deployment never became healthy.
- `FAIL race-health: GET /health -> 000`: the race server is down.

**Restart or redeploy by hand** (CI holds no Railway token and never restarts anything):

1. Railway dashboard: project, the named service (`web` or `race-server`), Deployments. Read the latest deployment's
   logs first; if the build or the healthcheck failed, fix the cause on `main`.
2. A crashed or hung service: its menu, Restart. A bad deployment: Redeploy the last good one (its menu, Redeploy), or
   from a shell already logged in to Railway: `railway redeploy --service <web|race-server>`.
3. Postgres down (web `/api/health` 503): restart the Postgres service, then web.
4. Wait until Railway marks the deployment Active and its healthcheck passes.

**Confirm.** Actions, `uptime`, Run workflow on `main` (`workflow_dispatch`, or
`gh workflow run uptime.yml --ref main`). The run goes green with an `OK` line.
