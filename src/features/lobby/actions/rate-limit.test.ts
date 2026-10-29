import "dotenv/config";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "@/server/db-client";

// #207 C3, #699 C1-C2: the lobby actions behind the web limiter, over the test database and real Redis.
// ADR 0003: DB-backed tests target the test database. Each run uses its own IP subjects, whose
// limiter keys expire on their own within the 60 s window (no Redis client here: ADR 0020).

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

/** A fresh IPv6 literal from the documentation range: one bucket per call. */
const freshIp = () => {
  const hex = randomUUID().replaceAll("-", "");
  return `2001:db8:${hex.slice(0, 4)}:${hex.slice(4, 8)}:${hex.slice(8, 12)}:${hex.slice(12, 16)}::1`;
};

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
    const ip = () => {
      const value = freshIp();
      state.headers = new Headers({ "x-forwarded-for": value });
      return value;
    };

    beforeAll(async () => {
      if (!redisUrl) throw new Error("REDIS_URL is not set: load the worktree .env");
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
      if (state.issued.length) await db.user.deleteMany({ where: { id: { in: state.issued } } });
      await db.user.deleteMany({ where: { typistName: { startsWith: PREFIX } } }); // cascades
      await db.$disconnect();
    });

    /** A well-formed code no lobby uses. */
    const otherCode = (i: number) => `ZQX-${String(i).padStart(4, "0")}`;

    it("C1: 100 cookie-less joinByCode from one IP for one open lobby within 60 s all succeed", async () => {
      ip();
      const start = Date.now();
      for (let i = 0; i < 100; i++) {
        await expect(joinByCode({ code: CODE })).resolves.toEqual({ ok: true, code: CODE });
      }
      expect(Date.now() - start).toBeLessThan(60_000);
      expect(state.jar.size).toBe(0);
    });

    it("C1: one subject cycling through codes is refused once it has tried 20 distinct codes", async () => {
      ip();
      await expect(joinByCode({ code: CODE })).resolves.toEqual({ ok: true, code: CODE });
      for (let i = 1; i < 20; i++) {
        await expect(joinByCode({ code: otherCode(i) })).resolves.toEqual({
          ok: false,
          error: "not-found",
        });
      }
      const users = await db.user.count();
      const lobbies = await db.lobby.count();
      await expect(joinByCode({ code: otherCode(20) })).resolves.toEqual({
        ok: false,
        error: "rate-limited",
      });
      // Retrying a refused code, or asking the token action, does not get around the budget.
      await expect(joinByCode({ code: otherCode(20) })).resolves.toEqual({
        ok: false,
        error: "rate-limited",
      });
      await expect(mintRaceToken({ code: otherCode(21) })).resolves.toEqual({
        ok: false,
        error: "rate-limited",
      });
      // Unparsable input counts too.
      await expect(joinByCode({ code: "nope" })).resolves.toEqual({
        ok: false,
        error: "rate-limited",
      });
      expect(await db.user.count()).toBe(users);
      expect(await db.lobby.count()).toBe(lobbies);
      expect(state.jar.size).toBe(0);
      // The code this subject already found still works; another client is not throttled.
      await expect(joinByCode({ code: CODE })).resolves.toEqual({ ok: true, code: CODE });
      ip();
      await expect(joinByCode({ code: otherCode(20) })).resolves.toEqual({
        ok: false,
        error: "not-found",
      });
    });

    it("C2: 100 first-time mintRaceToken (no guest cookie) from one IP within 60 s all succeed", async () => {
      ip();
      const start = Date.now();
      for (let i = 0; i < 100; i++) {
        state.jar.clear(); // a new student: no guest cookie yet
        const result = await mintRaceToken({ code: CODE });
        expect(result.ok).toBe(true);
      }
      expect(Date.now() - start).toBeLessThan(60_000);
    });

    it("C2: repeated mints by one guest are still limited: the 11th within 60 s is refused", async () => {
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
    });

    it("C2: a cookie-less client cycling codes is refused before any guest is created", async () => {
      ip();
      for (let i = 0; i < 20; i++) {
        state.jar.clear();
        await expect(mintRaceToken({ code: otherCode(i) })).resolves.toEqual({
          ok: false,
          error: "not-found",
        });
      }
      const before = await db.user.count();
      // A 21st distinct code is refused before the lookup, even one of an open lobby.
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
