# @fifth-copy/limiter

Governing ADR: `docs/adr/0020-shared-rate-limiter.md` (with 0005 and 0008). Architecture: `docs/architecture/ARCHITECTURE.md` sections 4, 5 and 10.

One Redis-backed sliding-window rate limiter, shared by the web app (`src/server/limiter`) and the race server (`services/race-server/src/socket/rate-limit.ts`). Single responsibility: count calls per key per window.

## API
`createLimiter(redis, { prefix })` -> `{ limit(key, { max, windowMs }, now = Date.now()) }` -> `{ ok, remaining, retryAfterMs }`, and `count(key, windowMs, now)` -> the calls `limit` would count in that window, read-only (`WINDOW_COUNT_LUA`, `ZCOUNT`; #699: the web app checks whether a room code was already admitted without counting a call).
- `redis` is any client with `eval(script, numKeys, ...args)`; both processes pass ioredis. The package never imports a Redis client.
- One Lua script (`SLIDING_WINDOW_LUA`), atomic: sorted set per key, `ZREMRANGEBYSCORE` drops calls older than the window, `ZCARD` counts, `ZADD` records an allowed call (a refused call is not recorded), `PEXPIRE windowMs`.
- Key: `${prefix}:rl:${key}`. Every key carries a TTL <= `windowMs`.
- `retryAfterMs` is 0 when allowed, else in `(0, windowMs]` (when the oldest counted call leaves the window).
- A Redis failure rejects the promise: each process picks its policy (race server fails closed, web fails open, ADR 0020).
- Invalid input (empty key or prefix, `max` or `windowMs` not a positive integer) throws `RangeError` before any Redis call.

## Rules
- Pure TypeScript apart from the injected client: no `ioredis`, `node:*` or other package import (dependency-cruiser `limiter-is-self-contained`). Tests use a real Redis (`REDIS_URL`).
- Rules (`LIMITS`) belong to each caller, one table per process; callers render their own throttled states.
