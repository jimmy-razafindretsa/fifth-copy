# @fifth-copy/race-server

Governing ADRs: `docs/adr/0006-real-time-race-server.md`, `docs/adr/0008-room-state-and-persistence.md`. Architecture: `docs/architecture/ARCHITECTURE.md` section 7.

A separate Node process that holds the live connections of a race (Socket.IO, polling fallback on), runs the authoritative race loop with `@fifth-copy/engine`, and keeps room state in Redis. It is **database-less**: it reads lobby and text data and writes results through the web app's internal HTTP API (HMAC-signed), so Prisma and the schema stay in one process.

```
npm run dev:race     # tsx watch, http://localhost:4000/health
npm run build:race   # esbuild -> services/race-server/dist/main.js
```

## Rules
- Never import from `src/` (the Next.js app) or `@/`. Only `@fifth-copy/engine`, `@fifth-copy/protocol` and this package.
- `process.env` only in `src/env.ts` (zod-validated). Secrets are never logged. Variables: `RACE_SERVER_PORT`, `REDIS_URL`, `RACE_TOKEN_SECRET` (>= 32 chars, shared with the web app), `WEB_ORIGIN` (allowed Socket.IO CORS origin, the web app's public URL; default `http://localhost:3000`).
- Every inbound socket event and HTTP body is parsed with a `@fifth-copy/protocol` schema before use.
- Redis holds ephemeral state only (rooms, presence, resume keys, invite tokens, rate limits), always with a TTL. Anything that must survive a restart goes to Postgres through the internal API.
- Time comes from one injectable clock (`src/clock.ts`: `systemClock`, `createFakeClock`) so tests and the fast-clock e2e mode can control it.
- Tests under `src/rooms/`, `src/socket/` and `src/http/internal.test.ts` run against a real Redis at `REDIS_URL` (worktree `.env`; CI `check` job service) and fail when it is unreachable. They delete only their own keys: never `FLUSHDB` (card worktrees may share a db index).

## Waiting room (#165)
- Handshake: `io(url, { auth: { v: PROTOCOL_VERSION, token } })`. Refusals are `connect_error` with message `version`, `bad-token` or `no-room`; the room is always the token's `lobby` claim.
- On connect: `welcome` to the socket, `roster` to `lobby:<id>`; on the user's last disconnect: `roster` to the rest.
- `POST /internal/rooms` (web -> race server): HMAC over `${timestamp}.${rawBody}`, verified before the body is parsed; 401 `bad-signature`/`stale-timestamp`, 400 `bad-body` (also bodies over 64 kB), 426 `version`.
- Playwright starts this server as its first `webServer` with `WEB_ORIGIN` = the Playwright base URL. A reused local `npm run dev:race` keeps its own `WEB_ORIGIN`: stop it if browser sockets are refused in e2e.

## Layout (planned, one card each)
`src/main.ts` boot and graceful shutdown · `app.ts` composition root (`createRaceServer`) · `env.ts` · `http/` health router, internal API (`hmac.ts`, `internal.ts`: landed in #165), drain · `socket/` handshake (race token), waiting-room events (`server.ts`: landed in #165), rate limits · `testing/` integration harness (real Redis, `socket.io-client`) · `rooms/` room registry (`registry.ts`, `desks.ts`, `keys.ts`: waiting phase landed in #167), lifecycle state machine, tick loop (10 Hz) · `players/` presence, reconnection, idle · `bots/` server-side bots on the player code path · `redis/` client (`createRedis`) and adapters · `persist/` result outbox to the web app.
