# Backup and restore runbook

Procedures for the operator of the Railway project (ADR 0019, "Backups", #705). Linked from
`docs/architecture/ARCHITECTURE.md` section 11.4. Never paste a connection URL, password, backup id or Railway
credential into this file, an issue, a log or a commit. The privacy side (what the copies hold, the 14-day window)
is `docs/privacy/backup-retention.md`.

Facts from Railway's docs (Data & storage > Backups; CLI > `railway postgres`) that these steps rely on:
- A volume backup is an incremental, copy-on-write snapshot of the whole volume, made on a schedule or by hand.
- Schedules: **Daily** (kept 6 days), **Weekly** (kept 27 days), **Monthly** (kept 89 days). We use Daily only.
- A manual backup is capped at 50% of the volume's size; locking a backup removes its expiry.
- A restore works only onto the same service in the same project and environment. It mounts a new volume named
  after the backup's date stamp where the old one was, keeps the old volume in the project unmounted, and stages
  the change; nothing happens until **Deploy**.
- Wiping a volume deletes all of its backups.

## 1. Enable the schedules (once, production)

In the Railway dashboard, project `perfect-endurance`, environment `production`:

1. Open the `Postgres` service > **Settings** > **Backups** tab. Add the **Daily** schedule. Leave Weekly and
   Monthly off. Leave point-in-time recovery off (its archive outlives the 14-day window, ADR 0019).
2. Open the web service (`@fifth-copy/protocol` in the dashboard until renamed; the one with the `avatars`
   volume at `/data/avatars`) > **Settings** > **Backups** tab. Add the **Daily** schedule. Leave Weekly and
   Monthly off.
3. Applying the schedules redeploys `Postgres` and the web (a few seconds of downtime): do it in the night window.
4. Next day, check that each Backups tab lists one daily backup with a date stamp. No backup shows a lock.

## 2. Restore in an incident

Use it after a bad migration, a destructive script, or a lost or corrupted volume. The restore loses every write
made after the chosen backup (up to 24 hours), so pick the newest backup taken before the damage.

1. **Stop new writes.** Tell the teachers that Fifth Copy is down; do it outside class time if you can choose.
   Optionally pause the worker (scale it to 0 replicas) so no job writes during the switch.
2. **Postgres.** `Postgres` service > **Backups** tab > find the backup by its date stamp > **Restore**. Wait
   until Railway stages the change (seconds to minutes). Click **Details** at the top of the project canvas and
   check that the change mounts a volume named after that date stamp on `Postgres`, and nothing else. Click
   **Deploy**. Wait until `Postgres` is Active.
3. **Avatars (only if the avatar files are damaged too).** Web service > **Backups** tab > same steps as 2 with
   the backup closest to the Postgres one. **Deploy** redeploys the web; its pre-deploy runs
   `npx prisma migrate deploy`.
4. **Redeploy the web** (if step 3 did not) so its pre-deploy applies the migrations newer than the backup:
   web service > latest deployment > **Redeploy**. Then redeploy the worker (and scale it back to 1).
5. **Check the schema** (from a shell with `railway login` done and `railway link` to the project):
   ```
   railway ssh --service web
   # inside the web container (DATABASE_URL is the service's own variable):
   npx prisma migrate status
   ```
   Expected: `Database schema is up to date!`. If it lists pending migrations, the web's pre-deploy did not run or
   failed: read the web deploy logs, fix, redeploy, and run `npx prisma migrate status` again. Never run
   `migrate dev`, `migrate reset` or `db push` against this database (AGENTS.md, Prisma hazards).
6. **Check the app.** `GET /api/health` on the web domain answers 200; sign in as a teacher; open a class and a
   result; open a page that shows an avatar.
7. **Deletions since the backup.** The restored data contains accounts deleted after the backup time. Run the
   deletion purge for them before reopening (#81 owns that procedure).
8. **Clean up within 14 days.** Once the restore is accepted, delete the old unmounted volume(s) (they hold
   personal data outside any schedule): project canvas > the unmounted volume > **Settings** > delete. Until then
   they are the rollback: to roll back, mount the old volume again in place of the restored one and deploy.
9. Write the date, the backup's date stamp (not its id), what was restored and the outcome in `work/log/<n>.md`
   of the incident card. No values, no data.

## 3. Restore drill (C4 of #705; then once a term)

Railway restores a volume backup only onto its own service, so a drill with the Railway backup would restart
production. Owner decision (2026-11-11): the drill proves the database can be rebuilt elsewhere instead, with a
`pg_dump` piped inside Railway into a throwaway Postgres. Production is never restored, stopped or written. The
daily Railway backups (section 1) stay the real safety net. The `avatars` volume is not drilled: its restore is the
in-place path of section 2.

1. **No-shell method (used for the first drill, 2026-11-16).** In the production project, add a service named
   `drill-<YYYY-MM-DD>` from the Docker image `postgres:<major>` (the major of the production `Postgres` image),
   with **no volume**, restart policy **Never**, and these variables: `SOURCE_URL` = `${{Postgres.DATABASE_URL}}`
   (a reference: never paste or print the value) and `DRILL_B64` = the base64 of `scripts/ops/restore-drill.sh`
   (`base64 -w0 scripts/ops/restore-drill.sh`). Start command:
   `bash -c 'echo "$DRILL_B64" | base64 -d | bash; sleep 3600'`. Stage all of it and deploy once, so the service
   never starts without its variables.
2. The script starts a private Postgres inside the container (no listener, no volume), streams
   `pg_dump --no-owner --no-acl "$SOURCE_URL"` into it and prints only `DRILL ...` lines: dump and restore exit
   codes and error-line counts, the two `_prisma_migrations` counts of step 3, and `"User"`, `"Lobby"` and `"Race"`
   counts on the copy and on production. Read them in the service's deploy logs (filter `DRILL`). The dump never
   touches a file outside the container or leaves Railway.
   *Shell alternative:* add a **Postgres** service `drill-<YYYY-MM-DD>` with the same `SOURCE_URL`, then
   `railway ssh --service drill-<YYYY-MM-DD>` and run
   `pg_dump --no-owner --no-acl "$SOURCE_URL" | psql -q "$DATABASE_URL"` and the queries of step 3 by hand.
3. The checks, without printing any data:
   - finished, not rolled back migrations
     (`select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null`)
     must equal the number of folders in `prisma/migrations/` on `main`, and unfinished ones
     (`... where rolled_back_at is null and finished_at is null`) must be `0` (what `npx prisma migrate status`
     checks).
   - `select count(*)` on `"User"`, `"Lobby"` and `"Race"` must match production
     (rows added during the dump may make production one or two higher; anything else fails).
4. Pass: every check in step 3 holds. Fail: note which check differed.
5. Clean up the same day: delete the `drill-<YYYY-MM-DD>` service (and its volume, with the shell alternative: it
   holds a full copy of production data; the no-shell method has none, the copy dies with the container). Check in the project canvas that nothing named `drill-` remains.
6. Record in `work/log/705.md` (first drill) or the drill's card log: date, duration, pass or fail, and anything
   that differed from these steps. No values, ids or data. Fix this runbook in the same PR if a step was wrong.

## Never

- Turn on the Weekly or Monthly schedule, point-in-time recovery, or lock a backup: each keeps copies beyond the
  14-day window (`docs/privacy/retention.md`). Changing that needs an ADR 0019 amendment and a privacy update.
- Wipe a volume: it deletes all of its backups.
- Download a backup or a database dump to a laptop, or paste data into an issue.
