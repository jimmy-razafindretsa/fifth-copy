import { Redis } from "ioredis";

/**
 * The race server's Redis connection (ADR 0008). Lazy: nothing connects until the first command or
 * `connect()`. Errors are logged by code only, never with the URL (it may carry a password).
 */
export function createRedis(url: string, { keyPrefix }: { keyPrefix?: string } = {}): Redis {
  const redis = new Redis(url, {
    // Tests only: an isolated key space on the shared test db (#189 outbox tests).
    ...(keyPrefix ? { keyPrefix } : {}),
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    retryStrategy: (attempt) => Math.min(attempt * 200, 2_000),
  });
  // ioredis emits `error` on every failed (re)connect; without a listener the process crashes.
  redis.on("error", (err: NodeJS.ErrnoException) => {
    console.error(
      JSON.stringify({ level: "error", msg: "redis error", code: err.code ?? "unknown" }),
    );
  });
  return redis;
}
