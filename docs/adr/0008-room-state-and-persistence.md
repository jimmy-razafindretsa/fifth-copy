---
id: "0008"
title: Redis holds ephemeral room state with TTLs; Postgres is the only system of record, written by the web app
status: accepted
category: data
scope: ["services/race-server/src/redis/**", "services/race-server/src/rooms/**", "services/race-server/src/persist/**", "prisma/schema/race.prisma", "prisma/schema/stats.prisma", "prisma/schema/lobby.prisma", "src/features/results/**", "src/features/stats/**"]
supersedes: []
rule: Anything that must survive a restart or feed statistics is written to Postgres through a web-app internal route (zod + HMAC) and owned by one Prisma schema file per feature; Redis keeps only live room state, presence, resume keys, invite tokens and rate limits, every key with a TTL; raw keystrokes are a compressed per-player blob kept 30 days and rolled up daily into per-character stats in America/Toronto.
---

# 0008. Redis holds ephemeral room state with TTLs; Postgres is the only system of record, written by the web app

## Context
Spec section 16.2 puts room state, presence, reconnection tokens, host transfer and single-use links in Redis; section 16.4 lists the durable tables and asks for raw keystrokes with short retention rolled up into daily per-character stats. The race server is a separate process (ADR 0006) and the kit allows Prisma only in `src/server/**` and feature `queries/actions` (ADR 0002). Board cards #150, #151, #188, #189, #312, #314, #315, #339 depend on this choice.
#188 lands the first `race.prisma` migration (`race_domain`: `Race`, `RaceResult`, `RaceKeystrokes`) under this decision; it changes no decision here.

## Decision
### Ownership
| Data | Where | Owner | Lifetime |
|---|---|---|---|
| Lobby record (code, type, host, settings, status) | Postgres `lobby.prisma` | web `features/lobby` | until closed, then 24 h cleanup |
| Invite tokens (single-use) | Redis `invite:<token>` -> lobby id, consumed with an atomic `GETDEL` | race server via web action | 24 h TTL |
| Live room: members, desks, host, phase, clock, per-player progress, overlays, bonuses, cooldowns | Redis hash per room + in-process cache on the owning race server | race server | room TTL refreshed every tick; 1 h after last activity |
| Presence and resume keys | Redis `presence:<room>:<player>`, `resume:<key>` | race server | grace period (2 min) |
| Rate limits | Redis counters | race server and web (shared limiter, card #207) | window TTL |
| Race (text snapshot, settings, times), race results, raw keystrokes, char stats, achievements, texts, users | Postgres | web app features | durable |

### Write path at race end
1. The race server builds one `InternalRaceResult` per player (engine state, flags, bonus log, keystroke trace compressed with gzip, `ENGINE_VERSION`) and pushes them to a Redis outbox list for the room.
2. It POSTs them to `/api/internal/races/:id/results` (HMAC, idempotency key = race id + desk). The web route validates with the protocol schema, writes in one transaction (`RaceResult`, `RaceKeystrokes`), awards achievements, updates personal bests, and acknowledges. Acknowledged entries leave the outbox; failures retry with backoff; the outbox outlives a race-server restart.
3. Stats reads (`features/stats`) never touch raw keystrokes; they read `CharStatDaily` and `RaceResult`.

### Keystrokes and rollups
- `RaceKeystrokes` holds a gzip-compressed JSON array per (race, user), retained **30 days**, purged by the worker (ADR 0011).
- The worker rolls up yesterday's keystrokes into `CharStatDaily` (user, date, char, layout, hits, errors, avgMs) once a day and on demand after each race for the user's latest day, so the heatmap is fresh.
- **Day boundary and streaks use `America/Toronto`** (card #339), stored as a constant in `src/lib/time.ts`.
- Flagged races (`suspicious = true`) are stored but excluded from rollups, bests and callouts (R203).

### Restart behaviour
- Race server restart: rooms whose Redis hash is still present are rehydrated into `waiting` or `ended` state; a room that was `running` is **voided** (players see "Line cut, the cable was lost"; nothing is persisted) because the authoritative clock is gone (cards #204, #205). Deploys avoid this by draining (ADR 0012).
- Redis loss: live rooms end with the same void state; Postgres is untouched. Nothing durable is ever only in Redis.

### Schema layout
One Prisma file per feature in `prisma/schema/`: `identity.prisma`, `lobby.prisma`, `race.prisma`, `texts.prisma`, `stats.prisma`, `jobs.prisma`. Cross-feature relations are allowed; field lists live only there.

## Consequences
- The race server has no database driver, no migrations and no secrets beyond the HMAC secret and Redis URL; it can be load-tested in isolation.
- The internal results route is the single validated write path for race data, which keeps anti-cheat exclusion and achievement rules in one place.
- An extra network hop at race end (milliseconds) and a Redis outbox to maintain.

## Alternatives considered
- **Race server writes Postgres directly with its own Prisma client:** fewer hops, but two processes would share the schema and migrations, Prisma would leave `src/`, and result validation would live in two places. Rejected.
- **Postgres for live room state:** durable but 10 Hz writes for 100 players is the wrong tool; the spec names Redis. Rejected.
- **Keep raw keystrokes forever:** simpler, but Law 25 minimisation and table growth argue for 30 days plus rollups, as the spec says.
