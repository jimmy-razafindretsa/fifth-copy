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

/** What `createLimiter` returns: `limit`, plus a read-only count (#699) and `admit` (#701). */
export type WindowLimiter = Limiter & {
  /**
   * One attempt of an item (marker `markerKey`) against a budget of distinct items (`budgetKey`),
   * atomically: an item already admitted in the window passes without spending; otherwise one call
   * is counted against `budgetKey` as `limit` would, and only when it is allowed the item is
   * admitted for `rule.windowMs`. Concurrent first attempts of one item spend once. `remaining` is
   * what the budget has left. Rejects when Redis fails.
   */
  admit(budgetKey: string, markerKey: string, rule: LimitRule, now?: number): Promise<LimitResult>;
  /**
   * The calls of `key` counted in the `windowMs` span ending at `now`, as `limit` would count them,
   * without counting one and without writing anything. Rejects when Redis fails.
   */
  count(key: string, windowMs: number, now?: number): Promise<number>;
  /**
   * Forgets every call counted for `key` (#789: a new reset code clears its account's redeem
   * budget), so the next `limit` starts a fresh window. Rejects when Redis fails.
   */
  clear(key: string): Promise<void>;
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

/**
 * KEYS[1] as above; ARGV = now, windowMs. Read-only: the calls scored after `now - windowMs` (the
 * ones `SLIDING_WINDOW_LUA` keeps). A missing key counts 0.
 */
export const WINDOW_COUNT_LUA = `
return redis.call('ZCOUNT', KEYS[1], '(' .. (tonumber(ARGV[1]) - tonumber(ARGV[2])), '+inf')
`;

/**
 * KEYS[1] = budget (as `SLIDING_WINDOW_LUA`), KEYS[2] = the item's marker (a sorted set holding
 * at most one admission). ARGV = now, windowMs, max, member. Atomic, so a marker cannot be missed by
 * two calls at once. Both keys are trimmed to the window and expire one window after their last
 * write. Returns { allowed (0|1), remaining, retryAfterMs }.
 */
export const ADMIT_ONCE_LUA = `
local budget = KEYS[1]
local marker = KEYS[2]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local max = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', budget, '-inf', now - window)
redis.call('ZREMRANGEBYSCORE', marker, '-inf', now - window)
local count = redis.call('ZCARD', budget)
if redis.call('ZCARD', marker) > 0 then
  return { 1, math.max(0, max - count), 0 }
end
if count < max then
  redis.call('ZADD', budget, now, ARGV[4])
  redis.call('PEXPIRE', budget, window)
  redis.call('ZADD', marker, now, ARGV[4])
  redis.call('PEXPIRE', marker, window)
  return { 1, max - count - 1, 0 }
end
local oldest = redis.call('ZRANGE', budget, 0, 0, 'WITHSCORES')
redis.call('PEXPIRE', budget, window)
return { 0, 0, tonumber(oldest[2]) + window - now }
`;

/** KEYS[1] = `${prefix}:rl:${key}`; deletes it. Returns the number of keys removed (0 or 1). */
export const CLEAR_LUA = `return redis.call('DEL', KEYS[1])`;

const isPositiveInt = (n: number) => Number.isSafeInteger(n) && n > 0;

export function createLimiter(redis: EvalClient, opts: { prefix: string }): WindowLimiter {
  if (!opts.prefix) throw new RangeError("limiter prefix must not be empty");
  // Members must be unique per call: two calls in the same millisecond are two calls.
  let seq = 0;
  const tag = Math.random().toString(36).slice(2, 10);
  const checkRule = (rule: LimitRule) => {
    if (!isPositiveInt(rule.max) || !isPositiveInt(rule.windowMs)) {
      throw new RangeError("limiter rule needs integer max and windowMs >= 1");
    }
  };
  const member = (at: number) => {
    seq = (seq + 1) % Number.MAX_SAFE_INTEGER;
    return `${at}:${tag}:${seq}`;
  };
  const toResult = (reply: unknown, rule: LimitRule): LimitResult => {
    const [allowed, remaining, retry] = (reply as unknown[]).map(Number) as [
      number,
      number,
      number,
    ];
    if (allowed === 1) return { ok: true, remaining, retryAfterMs: 0 };
    // A clock that went backwards (injected `now`) could push the oldest call ahead: clamp.
    const retryAfterMs = Math.min(rule.windowMs, Math.max(1, retry));
    return { ok: false, remaining: Math.max(0, remaining), retryAfterMs };
  };
  return {
    async admit(budgetKey, markerKey, rule, now = Date.now()) {
      if (!budgetKey || !markerKey) throw new RangeError("limiter key must not be empty");
      if (budgetKey === markerKey) throw new RangeError("limiter admit keys must differ");
      checkRule(rule);
      const at = Math.floor(now);
      const reply = await redis.eval(
        ADMIT_ONCE_LUA,
        2,
        `${opts.prefix}:rl:${budgetKey}`,
        `${opts.prefix}:rl:${markerKey}`,
        at,
        rule.windowMs,
        rule.max,
        member(at),
      );
      return toResult(reply, rule);
    },
    async clear(key) {
      if (!key) throw new RangeError("limiter key must not be empty");
      await redis.eval(CLEAR_LUA, 1, `${opts.prefix}:rl:${key}`);
    },
    async count(key, windowMs, now = Date.now()) {
      if (!key) throw new RangeError("limiter key must not be empty");
      if (!isPositiveInt(windowMs))
        throw new RangeError("limiter windowMs must be an integer >= 1");
      const reply = await redis.eval(
        WINDOW_COUNT_LUA,
        1,
        `${opts.prefix}:rl:${key}`,
        Math.floor(now),
        windowMs,
      );
      return Number(reply);
    },
    async limit(key, rule, now = Date.now()) {
      if (!key) throw new RangeError("limiter key must not be empty");
      checkRule(rule);
      const at = Math.floor(now);
      const reply = await redis.eval(
        SLIDING_WINDOW_LUA,
        1,
        `${opts.prefix}:rl:${key}`,
        at,
        rule.windowMs,
        rule.max,
        member(at),
      );
      return toResult(reply, rule);
    },
  };
}
