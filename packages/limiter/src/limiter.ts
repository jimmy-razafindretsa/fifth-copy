// One sliding-window rate limiter for both processes (ADR 0020, ADR 0008: rate limits are a Redis key
// family, every key with a TTL). Pure TypeScript over an injected client: no ioredis import here,
// any client with `eval` fits (ioredis in the web app and in the race server).

/** The one Redis command the limiter needs. ioredis' `Redis` satisfies it structurally. */
export type EvalClient = {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
};

/** At most `max` allowed calls in any `windowMs` span, per key. */
export type LimitRule = { max: number; windowMs: number };

/**
 * `ok`: the call is allowed (and counted). `remaining`: calls still allowed in the window.
 * `retryAfterMs`: 0 when allowed, else in `(0, windowMs]`: when the oldest counted call leaves.
 */
export type LimitResult = { ok: boolean; remaining: number; retryAfterMs: number };

export type Limiter = {
  /** Counts one call of `key` at `now` (ms epoch) against `rule`. Rejects when Redis fails. */
  limit(key: string, rule: LimitRule, now?: number): Promise<LimitResult>;
};

/**
 * KEYS[1] = `${prefix}:rl:${key}` (sorted set: one member per allowed call, scored by its time).
 * ARGV = now, windowMs, max, member. Atomic: concurrent calls on one key never over-allow.
 * Calls older than the window are dropped; a refused call is not recorded. The key expires one
 * window after the last call, so it never outlives the window it counts.
 * Returns { allowed (0|1), remaining, retryAfterMs }.
 */
export const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local max = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
local count = redis.call('ZCARD', key)
local allowed = 0
local retry = 0
if count < max then
  redis.call('ZADD', key, now, ARGV[4])
  count = count + 1
  allowed = 1
else
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  retry = tonumber(oldest[2]) + window - now
end
redis.call('PEXPIRE', key, window)
return { allowed, max - count, retry }
`;

const isPositiveInt = (n: number) => Number.isSafeInteger(n) && n > 0;

export function createLimiter(redis: EvalClient, opts: { prefix: string }): Limiter {
  if (!opts.prefix) throw new RangeError("limiter prefix must not be empty");
  // Members must be unique per call: two calls in the same millisecond are two calls.
  let seq = 0;
  const tag = Math.random().toString(36).slice(2, 10);
  return {
    async limit(key, rule, now = Date.now()) {
      if (!key) throw new RangeError("limiter key must not be empty");
      if (!isPositiveInt(rule.max) || !isPositiveInt(rule.windowMs)) {
        throw new RangeError("limiter rule needs integer max and windowMs >= 1");
      }
      const at = Math.floor(now);
      seq = (seq + 1) % Number.MAX_SAFE_INTEGER;
      const reply = await redis.eval(
        SLIDING_WINDOW_LUA,
        1,
        `${opts.prefix}:rl:${key}`,
        at,
        rule.windowMs,
        rule.max,
        `${at}:${tag}:${seq}`,
      );
      const [allowed, remaining, retry] = (reply as unknown[]).map(Number) as [
        number,
        number,
        number,
      ];
      if (allowed === 1) return { ok: true, remaining, retryAfterMs: 0 };
      // A clock that went backwards (injected `now`) could push the oldest call ahead: clamp.
      const retryAfterMs = Math.min(rule.windowMs, Math.max(1, retry));
      return { ok: false, remaining: Math.max(0, remaining), retryAfterMs };
    },
  };
}
