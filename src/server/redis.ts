import "server-only";
import { Redis } from "ioredis";

/**
 * The web app's one Redis client factory (ADR 0020): the limiter (`src/server/limiter`) and the
 * internal-request nonce store (`src/server/internal-api/nonces.ts`, #716) build their lazy
 * clients here. One retry per command, a 1 s connect timeout, reconnects backing off to 5 s.
 * Connection errors are reported by the callers' own guards, never with the URL.
 */
export function createRedisClient(url: string): Redis {
  const redis = new Redis(url, {
    maxRetriesPerRequest: 1,
    connectTimeout: 1_000,
    retryStrategy: (attempt) => Math.min(attempt * 500, 5_000),
  });
  redis.on("error", () => {});
  return redis;
}
