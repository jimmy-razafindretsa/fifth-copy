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
