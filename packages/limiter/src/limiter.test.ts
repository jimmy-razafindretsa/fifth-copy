import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLimiter, type Limiter } from "./index";

// #207 C1: the limiter against real Redis (the worktree's REDIS_URL). Fails, never skips, without it.
// Every test uses keys of its own under a fresh prefix, deleted at the end (shared db index).

let redis: Redis;
let limiter: Limiter;
const prefix = `t207:${randomUUID()}`;
const T0 = 1_800_000_000_000;

beforeAll(async () => {
  // eslint-disable-next-line no-restricted-properties
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is not set: load the worktree .env (set -a; . ./.env)");
  redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
  await redis.connect();
  limiter = createLimiter(redis, { prefix });
});

afterAll(async () => {
  const keys = await redis.keys(`${prefix}:*`);
  if (keys.length) await redis.del(...keys);
  redis.disconnect();
});

describe("createLimiter (C1, real Redis)", () => {
  it("allows exactly max calls in the window, refuses the next with retryAfterMs in (0, windowMs]", async () => {
    const rule = { max: 5, windowMs: 1_000 };
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await limiter.limit("a", rule, T0 + i * 10));
    expect(results.map((r) => r.ok)).toEqual([true, true, true, true, true]);
    expect(results.map((r) => r.remaining)).toEqual([4, 3, 2, 1, 0]);
    expect(results.every((r) => r.retryAfterMs === 0)).toBe(true);

    const refused = await limiter.limit("a", rule, T0 + 100);
    expect(refused.ok).toBe(false);
    expect(refused.remaining).toBe(0);
    expect(refused.retryAfterMs).toBeGreaterThan(0);
    expect(refused.retryAfterMs).toBeLessThanOrEqual(rule.windowMs);
    // The oldest call (T0) leaves the window at T0 + 1000.
    expect(refused.retryAfterMs).toBe(900);
  });

  it("allows again once the window slid past the oldest calls (injected now)", async () => {
    const rule = { max: 2, windowMs: 1_000 };
    expect((await limiter.limit("b", rule, T0)).ok).toBe(true);
    expect((await limiter.limit("b", rule, T0 + 500)).ok).toBe(true);
    expect((await limiter.limit("b", rule, T0 + 999)).ok).toBe(false);
    // T0 leaves the window: one slot back, the T0 + 500 call still counts.
    const back = await limiter.limit("b", rule, T0 + 1_000);
    expect(back).toEqual({ ok: true, remaining: 0, retryAfterMs: 0 });
    expect((await limiter.limit("b", rule, T0 + 1_001)).ok).toBe(false);
    // A whole window later everything is free again.
    expect(await limiter.limit("b", rule, T0 + 5_000)).toEqual({
      ok: true,
      remaining: 1,
      retryAfterMs: 0,
    });
  });

  it("refused calls do not count against the window", async () => {
    const rule = { max: 1, windowMs: 1_000 };
    expect((await limiter.limit("c", rule, T0)).ok).toBe(true);
    for (let i = 1; i < 10; i++)
      expect((await limiter.limit("c", rule, T0 + i * 50)).ok).toBe(false);
    expect((await limiter.limit("c", rule, T0 + 1_000)).ok).toBe(true);
  });

  it("keys carry the prefix scheme and a TTL <= windowMs", async () => {
    const rule = { max: 3, windowMs: 2_000 };
    await limiter.limit("ttl", rule, T0);
    const key = `${prefix}:rl:ttl`;
    expect(await redis.exists(key)).toBe(1);
    const ttl = await redis.pttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(rule.windowMs);
    // A refused call refreshes the TTL but never beyond the window.
    await limiter.limit("ttl", rule, T0 + 1);
    await limiter.limit("ttl", rule, T0 + 2);
    await limiter.limit("ttl", rule, T0 + 3);
    const after = await redis.pttl(key);
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThanOrEqual(rule.windowMs);
  });

  it("two keys never interfere", async () => {
    const rule = { max: 2, windowMs: 1_000 };
    expect((await limiter.limit("x", rule, T0)).ok).toBe(true);
    expect((await limiter.limit("x", rule, T0)).ok).toBe(true);
    expect((await limiter.limit("x", rule, T0)).ok).toBe(false);
    expect(await limiter.limit("y", rule, T0)).toEqual({ ok: true, remaining: 1, retryAfterMs: 0 });
    // Two limiters with other prefixes on the same key name stay apart too.
    const other = createLimiter(redis, { prefix: `${prefix}:other` });
    expect((await other.limit("x", rule, T0)).ok).toBe(true);
  });

  it("200 concurrent calls on one key with max 100 allow exactly 100", async () => {
    const rule = { max: 100, windowMs: 10_000 };
    const results = await Promise.all(
      Array.from({ length: 200 }, () => limiter.limit("burst", rule, T0)),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(100);
    expect(results.filter((r) => !r.ok)).toHaveLength(100);
    expect(await redis.zcard(`${prefix}:rl:burst`)).toBe(100);
  });

  it("uses the real clock when now is omitted", async () => {
    const rule = { max: 1, windowMs: 60_000 };
    expect((await limiter.limit("clock", rule)).ok).toBe(true);
    const refused = await limiter.limit("clock", rule);
    expect(refused.ok).toBe(false);
    expect(refused.retryAfterMs).toBeGreaterThan(0);
    expect(refused.retryAfterMs).toBeLessThanOrEqual(rule.windowMs);
  });

  it.each([
    [{ max: 0, windowMs: 1_000 }],
    [{ max: 1.5, windowMs: 1_000 }],
    [{ max: 1, windowMs: 0 }],
    [{ max: 1, windowMs: Number.NaN }],
  ])("refuses an invalid rule %j without touching Redis", async (rule) => {
    await expect(limiter.limit("bad", rule, T0)).rejects.toThrow(RangeError);
    expect(await redis.exists(`${prefix}:rl:bad`)).toBe(0);
  });

  it("refuses an empty key or prefix", async () => {
    await expect(limiter.limit("", { max: 1, windowMs: 1_000 }, T0)).rejects.toThrow(RangeError);
    expect(() => createLimiter(redis, { prefix: "" })).toThrow(RangeError);
  });

  it("surfaces a Redis failure to the caller (each process picks its own policy)", async () => {
    const broken = createLimiter(
      { eval: () => Promise.reject(new Error("connection refused")) },
      { prefix },
    );
    await expect(broken.limit("k", { max: 1, windowMs: 1_000 }, T0)).rejects.toThrow(
      "connection refused",
    );
  });
});
