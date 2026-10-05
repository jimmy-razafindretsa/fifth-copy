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
- Time comes from one injectable clock (`src/clock.ts` when it lands) so tests and the fast-clock e2e mode can control it.

## Layout (planned, one card each)
`src/main.ts` boot and graceful shutdown · `env.ts` · `http/` health, drain, internal API client · `socket/` handshake (race token), event routing, rate limits · `rooms/` room registry, lifecycle state machine, tick loop (10 Hz) · `players/` presence, reconnection, idle · `bots/` server-side bots on the player code path · `redis/` adapters · `persist/` result outbox to the web app.
