---
id: "0011"
title: Background jobs run in a worker entry point of the web package with a Prisma-owned schedule table
status: proposed
category: architecture
scope: ["src/worker/**", "src/features/*/jobs/**", "prisma/schema/jobs.prisma"]
supersedes: []
rule: Scheduled and deferred work (daily char-stat rollup, keystroke purge, lobby and guest expiry, retention) is a job module under the owning feature's jobs/ folder, registered in src/worker/main.ts, run by a single worker process that claims runs through a Postgres advisory lock and records them in JobRun; jobs are idempotent and never run inside a request or the race server.
---

# 0011. Background jobs run in a worker entry point of the web package with a Prisma-owned schedule table

## Context
The daily per-character rollup (R206), the 30-day raw keystroke purge (R205), stale lobby cleanup (card #144), abandoned guest retention (card #86) and data-deletion follow-ups (card #81) need to run on a schedule, outside requests. The race server must stay database-less (ADR 0008). Card #313.

## Decision
- A third process, **the worker**, is `src/worker/main.ts` in the web package (`npm run worker`, `tsx src/worker/main.ts`; in production the same image as the web app with a different command). It imports feature job modules through their `index.ts` and uses the normal Prisma client and `src/env.ts`.
- **Scheduler:** a 60-line loop. Every minute it lists due jobs (fixed schedules declared in code: `rollupCharStats` daily at 03:30 America/Toronto, `purgeKeystrokes` daily, `expireLobbies` every 10 min, `purgeGuests` weekly), takes a `pg_try_advisory_lock(hash(jobName))`, writes a `JobRun` row (started, finished, status, error), runs the job, releases the lock. Two workers cannot run the same job at once; a crashed run is visible in `JobRun`.
- **On-demand work** (for example "roll up this user's today after a race") is enqueued as a `JobRun` row with `runAfter = now()` by the feature action; the loop picks it up. No Redis queue.
- Jobs are **idempotent** (rollups upsert by (user, date, char, layout); purges are range deletes) and **bounded** (batch sizes, time limits) so a rerun is always safe.
- Job code lives in `src/features/<feature>/jobs/*.ts`, tested with the test database like queries.

## Consequences
- No new infrastructure and no foreign schema in Postgres, so the CI drift check stays meaningful.
- Latency of on-demand jobs is up to one minute; acceptable for stats.
- If job volume or fan-out grows (many per-user jobs per minute), migrate to `pg-boss` keeping the same job module shape; that would be a new ADR.

## Alternatives considered
- **BullMQ on Redis:** mature, but Redis is ephemeral in this design and losing it would lose scheduled work. Rejected.
- **pg-boss:** cron and retries on Postgres, but it owns its own schema and connection pool and adds a dependency for four jobs. Kept as the upgrade path.
- **Cron inside the race server:** mixes a stateless real-time process with database work. Rejected.
- **Vercel-style cron hitting a route:** we self-host; a long rollup inside a request risks timeouts. Rejected.
