import "dotenv/config";
import { randomInt, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "@/server/db-client";

// #207 C3: the lobby actions behind the web limiter, over the test database and real Redis.
// ADR 0003: DB-backed tests target the test database. Each run uses its own IP subject and lobby.

// eslint-disable-next-line no-restricted-properties
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
// eslint-disable-next-line no-restricted-properties
const redisUrl = process.env.REDIS_URL;

const state = vi.hoisted(() => ({
  jar: new Map<string, { value: string }>(),
  /** Every guest cookie the actions set: their users are deleted at the end. */
  issued: [] as string[],
  headers: new Headers(),
  db: null as unknown,
  env: {
    NODE_ENV: "test" as const,
    AUTH_SECRET: "a".repeat(32),
    RACE_TOKEN_SECRET: "r".repeat(32),
    NEXT_PUBLIC_RACE_SERVER_URL: "http://race.test:4000",
    REDIS_URL: undefined as string | undefined,
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const c = state.jar.get(name);
      return c && { name, value: c.value };
    },
    set: (name: string, value: string) => {
      state.issued.push(value.slice(0, value.lastIndexOf(".")));
      state.jar.set(name, { value });
    },
    delete: (name: string) => void state.jar.delete(name),
  }),
  headers: async () => state.headers,
}));
vi.mock("@/env", () => ({ env: state.env }));
vi.mock("@/server/db", () => ({
  db: new Proxy({}, { get: (_t, key) => (state.db as Record<PropertyKey, unknown>)[key] }),
}));

const { joinByCode, mintRaceToken } = await import("../index");
const { ensureGuest } = await import("@/features/identity");

const PREFIX = `test-rl-${randomUUID().slice(0, 8)}-`;
// A code no other test file uses (they run in parallel on the same database).
const CODE = "RLT-7207";

/** A fresh client IP per call site, so reruns within 60 s never share a bucket. */
const freshIp = () =>
  `198.51.${randomInt(0, 255)}.${randomInt(1, 254)}-${randomUUID().slice(0, 6)}`;

async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number };
  await new Promise<void>((r) => server.close(() => r()));
  return port;
}

describe.skipIf(!testDatabaseUrl)(
  "lobby actions behind the limiter (C3, test DB + Redis)",
  { timeout: 30_000 },
  () => {
    let db: ReturnType<typeof createPrismaClient>;
    let redis: Redis;
    const ips: string[] = [];
    const ip = () => {
      const value = freshIp();
      ips.push(value);
      state.headers = new Headers({ "x-forwarded-for": value });
      return value;
    };

    beforeAll(async () => {
      if (!redisUrl) throw new Error("REDIS_URL is not set: load the worktree .env");
      redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
      await redis.connect();
      db = createPrismaClient(testDatabaseUrl!);
      await db.$connect();
      await db.lobby.deleteMany({ where: { code: CODE } });
      const host = await db.user.create({ data: { isGuest: true, typistName: `${PREFIX}host` } });
      await db.lobby.create({ data: { code: CODE, hostUserId: host.id } });
    }, 30_000);
    beforeEach(() => {
      state.jar.clear();
      state.db = db;
      state.env.REDIS_URL = redisUrl;
    });
    afterEach(() => void vi.restoreAllMocks());
    afterAll(async () => {
      for (const value of ips) {
        const keys = await redis.keys(`web:rl:*:ip:${value}`);
        if (keys.length) await redis.del(...keys);
      }
      redis.disconnect();
      if (state.issued.length) await db.user.deleteMany({ where: { id: { in: state.issued } } });
      await db.user.deleteMany({ where: { typistName: { startsWith: PREFIX } } }); // cascades
      await db.$disconnect();
    });

    it("the 21st joinByCode from one subject within 60 s is rate-limited and inserts nothing", async () => {
      ip();
      for (let i = 0; i < 20; i++) {
        await expect(joinByCode({ code: CODE })).resolves.toEqual({ ok: true, code: CODE });
      }
      const users = await db.user.count();
      const lobbies = await db.lobby.count();
      await expect(joinByCode({ code: CODE })).resolves.toEqual({
        ok: false,
        error: "rate-limited",
      });
      // Wrong codes are attempts too: guessing does not get around the bucket.
      await expect(joinByCode({ code: "ZZZ-0000" })).resolves.toEqual({
        ok: false,
        error: "rate-limited",
      });
      expect(await db.user.count()).toBe(users);
      expect(await db.lobby.count()).toBe(lobbies);
      expect(state.jar.size).toBe(0);
      // Another client is not throttled.
      ip();
      await expect(joinByCode({ code: CODE })).resolves.toEqual({ ok: true, code: CODE });
    });

    it("the 11th mintRaceToken from one subject within 60 s is rate-limited and inserts nothing", async () => {
      ip();
      // The subject is the guest from its cookie: one browser, one bucket.
      await ensureGuest();
      for (let i = 0; i < 10; i++) {
        const result = await mintRaceToken({ code: CODE });
        expect(result.ok).toBe(true);
      }
      const users = await db.user.count();
      await expect(mintRaceToken({ code: CODE })).resolves.toEqual({
        ok: false,
        error: "rate-limited",
      });
      expect(await db.user.count()).toBe(users);
      // A cookie-less client of a fresh IP is refused before any guest is created once its IP
      // bucket is spent.
      state.jar.clear();
      ip();
      for (let i = 0; i < 10; i++) {
        state.jar.clear();
        await mintRaceToken({ code: "ZZZ-0000" }); // not-found: no guest
      }
      const before = await db.user.count();
      await expect(mintRaceToken({ code: CODE })).resolves.toEqual({
        ok: false,
        error: "rate-limited",
      });
      expect(await db.user.count()).toBe(before);
      expect(state.jar.size).toBe(0);
    });

    it("with REDIS_URL on a closed port both actions still succeed and one warning is logged", async () => {
      state.env.REDIS_URL = `redis://127.0.0.1:${await closedPort()}/0`;
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      ip();
      await expect(joinByCode({ code: CODE })).resolves.toEqual({ ok: true, code: CODE });
      expect((await mintRaceToken({ code: CODE })).ok).toBe(true);
      await expect(joinByCode({ code: CODE })).resolves.toEqual({ ok: true, code: CODE });
      expect((await mintRaceToken({ code: CODE })).ok).toBe(true);
      const lines = warn.mock.calls.map(([line]) => JSON.parse(String(line)) as { msg: string });
      expect(lines).toHaveLength(1);
      expect(lines[0]!.msg).toBe("rate limiter unavailable, allowing");
    });
  },
);
