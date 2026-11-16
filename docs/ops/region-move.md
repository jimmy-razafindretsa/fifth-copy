# Region move: Railway production from `sfo` to `us-east` (#781)

One-time procedure for the operator. It moves every production service of the Railway project `perfect-endurance`
(environment `production`, ADR 0019) and its three volumes from the legacy region `sfo` to **US East Metal
(Virginia), region id `us-east4-eqdc4a`**. Never paste a connection URL, password, row content or Railway credential
into this file, an issue, a PR or a commit; the commands read them from the environment and print counts only.

**When:** a weekday night, 22:00 to 06:00 America/Toronto (owner decision on #781, 2026-11-04), outside class hours.
Announce the window in the PR and to the teachers the day before. Budget 90 minutes; the expected downtime is a few
minutes per volume (the volumes hold little data), but Railway gives no figure.

## What the Railway docs say (checked 2026-11-09)

- A service's region is set in the dashboard: service, **Settings > Scale > Regions** (docs: Regions; Optimize
  Performance). The change is a staged change: review it with **Details** on the canvas, then **Deploy**.
- No downtime for a service without a volume. A service **with a volume** needs the volume migrated to the new
  region; "this migration can take a while depending on the size of the volume, and will cause downtime of your
  service during that time". Domains and private networking (`*.railway.internal`) do not change.
- Config as Code can pin a region (`deploy.multiRegionConfig: {"us-east4-eqdc4a": {"numReplicas": 1}}`), but Config
  as Code is deprecated and stops being read on **2026-12-01**, new services cannot opt in, and only the race-server
  has a config file. So the region lives in the dashboard; `services/race-server/railway.json` stays deploy-only
  (`scripts/railway-config.test.ts` keeps it free of placement keys). Infrastructure as Code (`.railway/railway.ts`,
  `replicas: {"us-east4-eqdc4a": 1}`) would need the `railway` package and an ADR: out of scope here.
- Volume backups: service **Backups** tab, manual or scheduled; a manual backup is limited to 50 % of the volume
  size; a restore stages a new volume at the same mount path and keeps the old one unmounted; backups restore only
  into the same project and environment; **wiping a volume deletes all its backups**. The docs do not say whether a
  region migration keeps the source volume or its backups, hence the off-volume dump below.
- `sfo` is a legacy region and is not in the current region picker (US West Metal `us-west2`, US East Metal
  `us-east4-eqdc4a`, EU West Metal, Southeast Asia Metal). A rollback by region goes to `us-west2`, not back to `sfo`.

## Inventory (read on 2026-11-09 with the Railway connector, read-only)

| Service (dashboard name) | Role | Volume (capacity) | Downtime on move |
|---|---|---|---|
| `Redis` | live race state, limiter, nonces (nothing durable, ADR 0008) | `redis-volume` at `/data` (5 GB) | yes |
| `Postgres` | all durable data | `postgres-volume-uoi8` at `/var/lib/postgresql/data` (5 GB) | yes |
| `@fifth-copy/protocol` = **web** | Next.js | `avatars` at `/data/avatars` (1 GB) | yes |
| `@fifth-copy/race-server` | Socket.IO rooms | none | no (a normal deploy with drain, ADR 0019) |

Re-read it at step 1: if a service, volume or region differs, stop and update this table first.

## Steps (in order; do not start one before the previous one is verified)

Shell: logged in with `railway login`, linked with `railway link` to `perfect-endurance` / `production`. Set
`WEB=https://<web domain>` and `RACE=https://<race-server domain>` (the services' Railway domains). Keep a private
scratch file outside the repo for the counts.

1. **Freeze (22:00 or later).** No merge to `main` during the window (Railway deploys on push). Check that no race is
   live: `curl -s "$RACE/health"` shows `"rooms":0`. If not 0, wait for it or move the window. Confirm the
   inventory above in the dashboard (or `describe-environment` with the connector) and note each volume's used size.
2. **Health before.** `curl -s "$WEB/api/health"` is `{"ok":true,"db":"up",...}` and `curl -s "$RACE/health"` has
   `"ok":true`.
3. **Counts before (counts only).**
   ```sh
   railway ssh --service Postgres
   # inside the Postgres container: exact row count of every table, no row content
   psql -U "$PGUSER" -d "$PGDATABASE" -At -c "select table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1"
   exit
   railway ssh --service @fifth-copy/protocol
   find /data/avatars -type f | wc -l   # avatar file count
   exit
   ```
   Copy both outputs to the scratch file as `before`.
4. **Backups before the move.**
   - Dashboard: `Postgres` > Backups > create a manual backup; same for `@fifth-copy/protocol` (avatars). Wait until
     both are listed as complete. Redis needs none (live state only, every key has a TTL).
   - Off-volume dump of Postgres (survives a volume wipe). Needs a local `pg_dump` 18 and the Postgres TCP proxy
     (`DATABASE_PUBLIC_URL`); write it only to an encrypted disk, never into the repo:
     ```sh
     umask 077
     railway run --service Postgres -- sh -c 'pg_dump -Fc --no-owner -d "$DATABASE_PUBLIC_URL" -f "$HOME/fc-781.dump"'
     pg_restore --list "$HOME/fc-781.dump" | grep -c "TABLE DATA"   # > 0: the dump is readable
     ```
     It holds personal data: delete it once step 10 passes, at the latest after 14 days
     (`docs/privacy/backup-retention.md`).
5. **Move Redis.** `Redis` > Settings > Scale > Regions: replace `sfo` with US East Metal (`us-east4-eqdc4a`), 1
   replica. Details > review (region only) > Deploy. Accept the volume migration. Wait for the deployment to be
   Active. Check `curl -s "$RACE/health"` is ok and `curl -s "$WEB/api/health"` is ok (the web limiter fails open,
   the nonce store fails closed while Redis is away).
6. **Move Postgres.** Same change on `Postgres`; accept the volume migration; wait for Active. Check
   `curl -s "$WEB/api/health"` shows `"db":"up"` (the web still runs in `sfo` here: slower, but working).
7. **Move web.** Same change on `@fifth-copy/protocol` (avatars volume migration). Wait for Active; the pre-deploy
   `prisma migrate deploy` must report no pending migration. Check `/api/health`.
8. **Move race-server.** Same change on `@fifth-copy/race-server` (no volume). The old deployment drains (0 rooms,
   so it exits at once). Check `curl -s "$RACE/health"` is ok.
9. **Verify placement.** Every service and the three volumes show `us-east4-eqdc4a` in the dashboard or with the
   connector's `describe-environment`; nothing is left in `sfo`; no staged change is pending.
10. **Counts after.** Repeat step 3 before any smoke test (a smoke race writes rows). Every table count and the
    avatar file count equal `before`. Then smoke: open `$WEB`, sign in, see an avatar, create a private lobby, run a
    short race with a bot to its results.
11. **Record.** In `work/log/781.md`: date, start and end times, per-step downtime, health outputs (no secrets),
    the table of counts before/after (table name and number only). In ADR 0019, replace `pending` by the move date.
    Push to the #781 branch. Unfreeze `main`. Delete the local dump (step 4) once satisfied.

## Rollback

- **A volume migration fails or a moved service does not become healthy:** do not continue with the next step.
  Restore the service's pre-move backup (Backups tab > Restore > Details > Deploy); the restored volume mounts at the
  same path. If the region itself is the problem, set the service back to US West Metal `us-west2` (the closest to
  the old `sfo`) and let its volume migrate back.
- **Counts differ after step 10 (data lost):** stop writes first (remove the web's public domain or scale web to 0
  replicas), label #781 `needs-human`, and restore Postgres from the step-4 volume backup, or from the dump with
  `pg_restore --clean --if-exists --no-owner -d "$DATABASE_PUBLIC_URL" "$HOME/fc-781.dump"` (via `railway run
  --service Postgres -- sh -c '...'`). A restore replaces live data, so it runs only with the owner.
- **Partial move at 05:30 and not healthy:** roll the unfinished step back as above; a mixed-region state (for
  example Postgres in `us-east4-eqdc4a`, web in `sfo`) is slower but correct, and can stay until the next window.
- Redis loss is harmless: live rooms are voided (ADR 0008); the freeze in step 1 ensures there are none.

## After the move

- The PIA and backup docs name the new region in #706 (`docs/privacy/pia.md`, `backup-retention.md`);
  `docs/architecture/ARCHITECTURE.md` section 13 still says `sfo` (touches:arch, follow-up with #706).
- The workspace preferred region (Workspace settings) can be set to US East so new services land there.
