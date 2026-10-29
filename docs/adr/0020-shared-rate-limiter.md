---
id: "0020"
title: One shared Redis sliding-window rate limiter package for the web app and the race server
status: proposed
category: security
scope: ["packages/limiter/**", "src/server/limiter/**", "services/race-server/src/socket/rate-limit.ts"]
supersedes: []
rule: Rate limits go through `@fifth-copy/limiter` (one Lua sliding window, keys `${prefix}:rl:${key}` with a TTL <= the window, prefixes `web` and `race`); the package imports nothing (the Redis client is injected); the web app reaches it only through `src/server/limiter` (`limit(action, subject)`, fails open) and the race server only through `socket/rate-limit.ts` (per-socket buckets before any handler, fails closed); each process keeps its own `LIMITS` table.
---

# 0020. One shared Redis sliding-window rate limiter package for the web app and the race server

## Context
ADR 0008 lists rate limits as a Redis key family "shared by race server and web" with a window TTL, and ADR 0006 point 7 asks for per-socket rate limits and a payload cap on client events. ARCHITECTURE 10 names socket floods and lobby-code guessing among the threats. Card #207 builds the limiter once; #90 (sign-in), #120 (join codes) and #121/#122 (invites) wire more actions later. ADR 0005 puts code shared by two processes in `packages/*`, and adding a package changes ARCHITECTURE 5, hence this ADR. The owner approved `ioredis` in the web app's dependencies and the new package (DECISION on #207, 2026-10-29).

## Decision
- **Package** `packages/limiter` (`@fifth-copy/limiter`): `createLimiter(redis, { prefix })` -> `limit(key, { max, windowMs }, now = Date.now())` -> `{ ok, remaining, retryAfterMs }`. `redis` is any client with `eval(script, numKeys, ...args)`; the package imports no Redis client and nothing else (dependency-cruiser `limiter-is-self-contained`).
- **Algorithm**: one Lua script, atomic per key: a sorted set of allowed calls scored by time; `ZREMRANGEBYSCORE` drops calls older than the window, `ZCARD` counts, `ZADD` records the call only when allowed, `PEXPIRE windowMs`. `retryAfterMs` is when the oldest counted call leaves, in `(0, windowMs]`.
- **Key scheme**: `${prefix}:rl:${key}`, every key with a TTL <= its window (ADR 0008). Web: `web:rl:<action>:<subject>`. Race server: `race:rl:sock:<socket id>:<event>`.
- **Web** (`src/server/limiter`): `limit(action, subject)` over a per-process `LIMITS` table (`join-by-code` 20/60 s, `mint-race-token` 10/60 s; `sign-in`, `recovery`, `invite` defined for later cards). `requestSubject()` is the guest of a valid guest cookie, else the client IP (the last `X-Forwarded-For` hop, written by the reverse proxy). The Redis client is created lazily from `REDIS_URL` (new, optional for web; absent = limiter disabled, one warning in production). **Fails open**: a Redis error or a call slower than 250 ms allows the action and logs one warning per outage, because joining a lobby must not depend on Redis. Features reach the limiter only through `src/server/limiter`; only that folder imports `ioredis` in `src/`.
- **Race server** (`socket/rate-limit.ts`): one Socket.IO packet middleware per socket, before every handler and before the registry's per-room queue: `keys` 25/s, `ping` 2/s, `host:start`, `host:settings`, `abandon`, `bonus:play` 5 per 10 s each. Any message whose payload exceeds 4 kB is refused before any schema parsing (a bounded size walk, no serialisation). A refused message is dropped and answered `rejected { reason: "rate-limit" }` (no protocol change); 3 refusals within 10 s disconnect the socket with one log line (socket id, lobby, count; never the payload). **Fails closed**: a message Redis cannot count is dropped (logged once per socket), not counted as a refusal. The Socket.IO `maxHttpBufferSize` (1 MB default) still bounds what reaches the middleware.

## Consequences
- One limiter, one key family and one test suite (real Redis) for both processes; a new throttled action is one `LIMITS` row and one `limit()` call.
- Every race-server client message costs one Redis round trip before its handler; ordering per socket is kept (one connection, FIFO), and refusals never reach the per-room queue (the #101 pen-test finding).
- The web app gains `ioredis` and `REDIS_URL` (ARCHITECTURE 11.2); a Redis outage silently lifts web limits (logged), while it stops race-server traffic, which needs Redis anyway.
- Cookie-less clients behind one NAT share an IP bucket. The e2e web server runs with the limiter off for the same reason (one IP for the whole suite).

## Alternatives considered
- Two thin adapters over a documented Lua script, the web on Postgres advisory counters: no new dependency, but two implementations of one rule and Postgres load per request (the card's fallback, declined by the owner).
- In-process token buckets: no Redis, but per-process counts (the web may run several instances) and no shared key family, against ADR 0008.
- Fixed-window `INCR` + `PEXPIRE`: cheaper, but allows 2x bursts at window edges.
