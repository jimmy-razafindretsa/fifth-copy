# @fifth-copy/race-server

Governing ADRs: `docs/adr/0006-real-time-race-server.md`, `docs/adr/0008-room-state-and-persistence.md`. Architecture: `docs/architecture/ARCHITECTURE.md` section 7.

A separate Node process that holds the live connections of a race (Socket.IO, polling fallback on), runs the authoritative race loop with `@fifth-copy/engine`, and keeps room state in Redis. It is **database-less**: it reads lobby and text data and writes results through the web app's internal HTTP API (HMAC-signed), so Prisma and the schema stay in one process.

```
npm run dev:race     # tsx watch, http://localhost:4000/health
npm run build:race   # esbuild -> services/race-server/dist/main.js
```

## Rules
- Never import from `src/` (the Next.js app) or `@/`. Only `@fifth-copy/engine`, `@fifth-copy/protocol` and this package.
- `process.env` only in `src/env.ts` (zod-validated). Secrets are never logged. Variables: `RACE_SERVER_PORT`, `REDIS_URL`, `RACE_TOKEN_SECRET` (>= 32 chars, shared with the web app), `WEB_ORIGIN` (allowed Socket.IO CORS origin, the web app's public URL; default `http://localhost:3000`), `RACE_FAST_CLOCK` (`"0"` default, `"1"` divides every lifecycle duration by 10 for e2e, ADR 0012).
- Every inbound socket event and HTTP body is parsed with a `@fifth-copy/protocol` schema before use.
- Redis holds ephemeral state only (rooms, presence, resume keys, invite tokens, rate limits), always with a TTL. Anything that must survive a restart goes to Postgres through the internal API.
- Time comes from one injectable clock and scheduler (`src/clock.ts`: `systemClock`/`systemScheduler`, `createFakeClock`/`createFakeScheduler`, whose `advance` fires due timers) so tests and the fast-clock e2e mode can control it.
- Tests under `src/rooms/`, `src/socket/` and `src/http/internal.test.ts` run against a real Redis at `REDIS_URL` (worktree `.env`; CI `check` job service) and fail when it is unreachable. They delete only their own keys: never `FLUSHDB` (card worktrees may share a db index).

## Waiting room (#165)
- Handshake: `io(url, { auth: { v: PROTOCOL_VERSION, token } })`. Refusals are `connect_error` with message `version`, `bad-token` or `no-room`; the room is always the token's `lobby` claim.
- On connect: `welcome` to the socket, `roster` to `lobby:<id>`; on the user's last disconnect: `roster` to the rest.
- `POST /internal/rooms` (web -> race server): HMAC over `${timestamp}.${rawBody}`, verified before the body is parsed; 401 `bad-signature`/`stale-timestamp`, 400 `bad-body` (also bodies over 64 kB), 426 `version`.
- Playwright starts this server as its first `webServer` with `WEB_ORIGIN` = the Playwright base URL. A reused local `npm run dev:race` keeps its own `WEB_ORIGIN`: stop it if browser sockets are refused in e2e.

## Race lifecycle (#166)
`rooms/lifecycle.ts` owns the phase transitions (ARCHITECTURE 7.1); each runs in the registry's per-room queue (`withRoom`) and writes the room hash (phase, `raceId`, `t0`, `endAt`, `race`, `desks`, one MULTI with the TTLs) before it emits.
- `host:start {v}` is answered by its ack only: `not-host` (token role not `host` or `sub` not the room's host), `not-waiting`, `too-few` (< 2 members), `start-failed` (the web start call threw, timed out after 5 s or answered another race id; nothing emitted, still `waiting`), else `{ ok: true, raceId }`. A malformed payload gets no ack.
- On success: `countdown { race }` to the room with `t0 = now + COUNTDOWN_MS` (`rooms/durations.ts`); `running` at `t0`; `endRace(lobbyId, "timer")` at `endAt = t0 + timerS * 1000`, or `t0 + MAX_RACE_MS` for an untimed race (the wire's bound).
- `endRace(lobbyId, reason)` is the one exit (timer here, all-finished via `onDeskTerminal` in #173, void in #204): idempotent, phase `ended`, `ended { raceId, reason, ranking }` (`rooms/ranking.ts`: engine `rank` and scoring only) to the room, then `onRaceEnded` once.
- `ping {v, sent}` -> `pong {v, sent, serverNow}` to the sender, any phase. A new user's handshake after `waiting` is `connect_error` `in-progress`; a member's second tab gets `welcome` with the current phase and `race`.
- `persist/web-api.ts` is the port to `POST /api/internal/races`; main.ts wires `unavailableWebApi` until #199, so a live start acks `start-failed`.

## Live race (#173)
At GO the lifecycle's `onGo` opens the room's runtime (`rooms/desks-state.ts`: `t0`, normalised text, engine settings, a `DeskState` per desk = engine `PlayerState` + `lastKeyAt`, `timingAnomalies`, `trace`) and starts the tick (`rooms/tick.ts`); `onEnded` runs one last tick and refuses further keys; the states are freed after `onRaceEnded` (#189 reads the traces there) and dropped on room close.
- `keys { v, batch }` (`keysSchema`, <= 64 keys) goes to `rooms/ingest.ts`, synchronously, with no Redis read: `rejected { before-go }` before GO, `rejected { not-running }` after the end; a desk not `typing` is dropped silently. Each `t` is clamped into `[elapsed - 2000, min(elapsed + 200, MAX_RACE_MS)]` then raised to the desk's `lastT`; any clamp, decrease or raise counts one `timingAnomalies` per batch; every key goes through `applyKeystroke`. A desk turning terminal asks `onDeskTerminal`, which ends the race `all-finished` when every desk is terminal.
- Every `TICK_MS = 100`: dirty desks to the hash `room:<id>:desks` (one MULTI with `ROOM_TTL_S`), `snapshot { t, desks: [desk, cursor, correct, errors, statusCode][], ranks }` to the room (`rooms/live-rank.ts`, ranks via `rankingFor`), then `overtake`/`passed` to the desk rooms `lobby:<id>:desk:<n>`, `new-leader` and `finished { place }` to the room.
- `DesksState.set` is the seam for presence and idle (#178, #183). `welcome.state` carries the desk's engine state while a race runs.

## Layout (planned, one card each)
`src/main.ts` boot and graceful shutdown · `app.ts` composition root (`createRaceServer`) · `env.ts` · `http/` health router, internal API (`hmac.ts`, `internal.ts`: landed in #165), drain · `socket/` handshake (race token), waiting-room events (`server.ts`: landed in #165), rate limits · `testing/` integration harness (real Redis, `socket.io-client`) · `rooms/` room registry (`registry.ts`, `desks.ts`, `keys.ts`: waiting phase landed in #167), lifecycle state machine (`lifecycle.ts`, `durations.ts`, `ranking.ts`: landed in #166), live race (`desks-state.ts`, `ingest.ts`, `live-rank.ts`, `tick.ts`: landed in #173) · `players/` presence, reconnection, idle · `bots/` server-side bots on the player code path · `redis/` client (`createRedis`) and adapters · `persist/` result outbox to the web app.
