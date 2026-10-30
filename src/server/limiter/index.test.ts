import "dotenv/config";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:net";
import { Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { signGuestCookie } from "../auth/guest-cookie";
import { createWebLimit, LIMITS, subjectKey, WEB_LIMITER_PREFIX } from "./core";
import { TRUSTED_PROXY_HOPS, UNKNOWN_IP_SUBJECT } from "./subject";

// #207 C3: the web adapter over real Redis (the worktree's REDIS_URL), and its fail-open policy.
// Subjects are fresh per run; their keys are deleted at the end (shared db index).

// eslint-disable-next-line no-restricted-properties
const redisUrl = process.env.REDIS_URL;
const run = randomUUID();
const subject = (name: string) => `test:${run}:${name}`;

const state = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  headers: new Headers(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      state.cookie && name === "fc_guest" ? { name, value: state.cookie } : undefined,
  }),
  headers: async () => state.headers,
}));
vi.mock("@/env", () => ({ env: { NODE_ENV: "test", AUTH_SECRET: "a".repeat(32) } }));

let redis: Redis;
beforeAll(async () => {
  if (!redisUrl) throw new Error("REDIS_URL is not set: load the worktree .env (set -a; . ./.env)");
  redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  await redis.connect();
});
afterAll(async () => {
  const keys = await redis.keys(`${WEB_LIMITER_PREFIX}:rl:*:test:${run}:*`);
  if (keys.length) await redis.del(...keys);
  redis.disconnect();
});

/** A TCP port that accepts nothing: bound, then closed. */
async function closedPort(): Promise<number> {
  const server: Server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number };
  await new Promise<void>((r) => server.close(() => r()));
  return port;
}

describe("createWebLimit (C3, real Redis)", () => {
  const limits: { close(): void }[] = [];
  afterEach(() => limits.splice(0).forEach((l) => l.close()));
  const make = (opts: Parameters<typeof createWebLimit>[0]) => {
    const l = createWebLimit(opts);
    limits.push(l);
    return l;
  };

  it("lobby-codes: 20 per 60 s per subject, the 21st refused; another subject unaffected", async () => {
    const limit = make({ url: redisUrl, nodeEnv: "test" });
    for (let i = 0; i < LIMITS["lobby-codes"].max; i++) {
      expect((await limit("lobby-codes", subject("a"))).ok).toBe(true);
    }
    const refused = await limit("lobby-codes", subject("a"));
    expect(refused.ok).toBe(false);
    expect(refused.retryAfterMs).toBeGreaterThan(0);
    expect(refused.retryAfterMs).toBeLessThanOrEqual(60_000);
    expect((await limit("lobby-codes", subject("b"))).ok).toBe(true);
    // Actions are separate buckets of one subject.
    expect((await limit("mint-race-token", subject("a"))).ok).toBe(true);
    const ttl = await redis.pttl(`${WEB_LIMITER_PREFIX}:rl:lobby-codes:${subject("a")}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60_000);
  });

  it("mint-race-token: the 11th within 60 s is refused", async () => {
    const limit = make({ url: redisUrl, nodeEnv: "test" });
    const verdicts = [];
    for (let i = 0; i < 11; i++) verdicts.push((await limit("mint-race-token", subject("m"))).ok);
    expect(verdicts).toEqual([...Array<boolean>(10).fill(true), false]);
  });

  it("defines the lobby rules (#699), the clerk outfit rule (#687) and the rules #90, #120 and #121 will wire", () => {
    expect(Object.keys(LIMITS).sort()).toEqual([
      "clerk-outfit",
      "invite",
      "join-by-code",
      "lobby-codes",
      "mint-race-token",
      "mint-race-token-new-guest",
      "recovery",
      "sign-in",
    ]);
    expect(LIMITS["join-by-code"]).toEqual({ max: 120, windowMs: 60_000 });
    expect(LIMITS["mint-race-token"]).toEqual({ max: 10, windowMs: 60_000 });
    expect(LIMITS["mint-race-token-new-guest"]).toEqual({ max: 120, windowMs: 60_000 });
    expect(LIMITS["lobby-codes"]).toEqual({ max: 20, windowMs: 60_000 });
    expect(LIMITS["clerk-outfit"]).toEqual({ max: 30, windowMs: 60_000 });
  });

  it("fails open on a closed port with one warning, never the URL", async () => {
    const warn = vi.fn();
    const port = await closedPort();
    const url = `redis://:secret-pw@127.0.0.1:${port}/0`;
    const limit = make({ url, nodeEnv: "production", warn });
    const verdicts = await Promise.all(
      Array.from({ length: 5 }, () => limit("join-by-code", subject("down"))),
    );
    for (let i = 0; i < 3; i++) verdicts.push(await limit("mint-race-token", subject("down")));
    expect(verdicts.every((v) => v.ok)).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toBe("rate limiter unavailable, allowing");
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/secret-pw|127\.0\.0\.1/);
  });

  it("fails open when Redis answers slower than the timeout", async () => {
    const warn = vi.fn();
    const limit = make({ url: redisUrl, nodeEnv: "test", warn, timeoutMs: 0 });
    const verdict = await limit("join-by-code", subject("slow"));
    expect(verdict.ok).toBe(true);
    expect(warn).toHaveBeenCalledWith("rate limiter unavailable, allowing", { cause: "timeout" });
  });

  it("without a URL: every call allowed, one warning in production, none elsewhere", async () => {
    const warnProd = vi.fn();
    const prod = make({ url: undefined, nodeEnv: "production", warn: warnProd });
    for (let i = 0; i < 30; i++) expect((await prod("join-by-code", subject("off"))).ok).toBe(true);
    expect(warnProd).toHaveBeenCalledTimes(1);
    const warnDev = vi.fn();
    const dev = make({ url: undefined, nodeEnv: "development", warn: warnDev });
    expect((await dev("join-by-code", subject("off"))).ok).toBe(true);
    expect(warnDev).not.toHaveBeenCalled();
  });
});

describe("requestSubject", () => {
  const load = async () => (await import("./subject")).requestSubject;
  afterEach(() => {
    state.cookie = undefined;
    state.headers = new Headers();
  });

  it("is the guest of a valid guest cookie", async () => {
    state.cookie = signGuestCookie("usr_abc", "a".repeat(32));
    state.headers = new Headers({ "x-forwarded-for": "203.0.113.9" });
    expect(await (await load())()).toBe("guest:usr_abc");
  });

  it("is the last X-Forwarded-For hop otherwise (the proxy's; earlier hops are client-supplied)", async () => {
    state.cookie = signGuestCookie("usr_abc", "b".repeat(32)); // forged: wrong secret
    state.headers = new Headers({ "x-forwarded-for": "1.2.3.4, 198.51.100.7" });
    expect(await (await load())()).toBe("ip:198.51.100.7");
  });

  it("falls back to x-real-ip, then unknown", async () => {
    state.headers = new Headers({ "x-real-ip": "198.51.100.8" });
    expect(await (await load())()).toBe("ip:198.51.100.8");
    state.headers = new Headers();
    expect(await (await load())()).toBe("ip:unknown");
  });

  it("takes the hop TRUSTED_PROXY_HOPS from the end, IP literals only (v6 lower-cased)", async () => {
    expect(TRUSTED_PROXY_HOPS).toBe(1);
    state.headers = new Headers({ "x-forwarded-for": "203.0.113.1, 2001:DB8::7 " });
    expect(await (await load())()).toBe("ip:2001:db8::7");
  });

  it.each([
    ["garbage", "not-an-ip"],
    ["a key-shaped value", "1.2.3.4:rl:join-by-code:x"],
    ["an empty last hop", "198.51.100.7, "],
    ["a host name", "proxy.example"],
    ["an over-long value", "9".repeat(5_000)],
  ])("is ip:unknown for %s in the last hop", async (_label, value) => {
    state.headers = new Headers({ "x-forwarded-for": value });
    expect(await (await load())()).toBe(UNKNOWN_IP_SUBJECT);
  });

  it("is ip:unknown for a non-IP x-real-ip", async () => {
    state.headers = new Headers({ "x-real-ip": "web:rl:*" });
    expect(await (await load())()).toBe(UNKNOWN_IP_SUBJECT);
  });
});

describe("subjectKey", () => {
  it("keeps short subjects of the safe charset", () => {
    expect(subjectKey("guest:usr_abc")).toBe("guest:usr_abc");
    expect(subjectKey("ip:2001:db8::7")).toBe("ip:2001:db8::7");
  });

  it("hashes anything else, so a subject never shapes the key and long ones never collide", () => {
    const long = "guest:" + "a".repeat(100);
    for (const subject of ["", "a b", "x\nweb:rl:*", "ip:{1}", long, `${long}b`]) {
      expect(subjectKey(subject)).toMatch(/^h:[0-9a-f]{64}$/);
    }
    expect(subjectKey(long)).not.toBe(subjectKey(`${long}b`));
  });
});

describe("createWebLimit.code: room-code attempts (#699, real Redis)", () => {
  const limits: { close(): void }[] = [];
  afterEach(() => limits.splice(0).forEach((l) => l.close()));
  const make = (opts: Parameters<typeof createWebLimit>[0]) => {
    const l = createWebLimit(opts);
    limits.push(l);
    return l;
  };
  const codeBudget = (s: string) => redis.zcard(`${WEB_LIMITER_PREFIX}:rl:lobby-codes:${s}`);
  const otherCode = (i: number) => `ZQX-${String(i).padStart(4, "0")}`;

  it("one (subject, code) pair gets 120 calls per 60 s and charges the code budget once", async () => {
    const limit = make({ url: redisUrl, nodeEnv: "test" });
    const s = subject("class");
    for (let i = 0; i < 120; i++) {
      expect((await limit.code("join-by-code", s, "KGB-4821")).ok).toBe(true);
    }
    const refused = await limit.code("join-by-code", s, "KGB-4821");
    expect(refused.ok).toBe(false);
    expect(refused.retryAfterMs).toBeGreaterThan(0);
    expect(await codeBudget(s)).toBe(1);
    // The other action keeps its own pair bucket and finds the code already admitted.
    expect((await limit.code("mint-race-token-new-guest", s, "KGB-4821")).ok).toBe(true);
    expect(await codeBudget(s)).toBe(1);
    for (const key of await redis.keys(`${WEB_LIMITER_PREFIX}:rl:*:${s}*`)) {
      const ttl = await redis.pttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60_000);
    }
  });

  it("a subject trying many codes is refused once 20 distinct codes are counted", async () => {
    const limit = make({ url: redisUrl, nodeEnv: "test" });
    const s = subject("cycle");
    for (let i = 0; i < 20; i++) {
      expect((await limit.code("join-by-code", s, otherCode(i))).ok).toBe(true);
    }
    expect((await limit.code("join-by-code", s, otherCode(20))).ok).toBe(false);
    // A refused code stays refused on retry, by either action.
    expect((await limit.code("join-by-code", s, otherCode(20))).ok).toBe(false);
    expect((await limit.code("mint-race-token-new-guest", s, otherCode(20))).ok).toBe(false);
    expect((await limit.code("mint-race-token-new-guest", s, otherCode(21))).ok).toBe(false);
    // A code admitted earlier in the window still passes.
    expect((await limit.code("join-by-code", s, otherCode(3))).ok).toBe(true);
    // Another subject is unaffected.
    expect((await limit.code("join-by-code", subject("cycle-2"), otherCode(20))).ok).toBe(true);
  });

  it("an unparsable code (null) counts against the code budget on every call", async () => {
    const limit = make({ url: redisUrl, nodeEnv: "test" });
    const s = subject("garbage");
    for (let i = 0; i < 20; i++) expect((await limit.code("join-by-code", s, null)).ok).toBe(true);
    expect((await limit.code("join-by-code", s, null)).ok).toBe(false);
    expect((await limit.code("join-by-code", s, otherCode(1))).ok).toBe(false);
  });

  it("fails open on a closed port with one warning", async () => {
    const warn = vi.fn();
    const limit = make({ url: `redis://127.0.0.1:${await closedPort()}/0`, nodeEnv: "test", warn });
    for (let i = 0; i < 3; i++) {
      expect((await limit.code("join-by-code", subject("down"), otherCode(i))).ok).toBe(true);
      expect((await limit.code("join-by-code", subject("down"), null)).ok).toBe(true);
    }
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("without a URL every call is allowed", async () => {
    const limit = make({ url: undefined, nodeEnv: "test" });
    for (let i = 0; i < 30; i++) {
      expect((await limit.code("join-by-code", subject("off"), otherCode(i))).ok).toBe(true);
    }
  });
});
