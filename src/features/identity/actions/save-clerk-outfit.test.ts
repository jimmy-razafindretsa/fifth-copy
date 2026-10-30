import "dotenv/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "@/server/db-client";
import { GUEST_COOKIE, signGuestCookie } from "@/server/auth/guest-cookie";
import type { Outfit } from "../clerk/outfit";

// ADR 0003: DB-backed tests target the test database, not the app env.
// eslint-disable-next-line no-restricted-properties
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const SECRET = "f".repeat(32);

// One browser cookie jar per test; the db swappable (ensure-guest.test.ts pattern).
const state = vi.hoisted(() => ({
  jar: new Map<string, { value: string; options?: Record<string, unknown> }>(),
  db: null as unknown,
  // The limiter's verdict for the next calls (the limiter itself is tested on real Redis).
  limited: false,
  limitCalls: [] as [string, string][],
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const c = state.jar.get(name);
      return c && { name, value: c.value };
    },
    set: (name: string, value: string, options: Record<string, unknown>) =>
      void state.jar.set(name, { value, options }),
    delete: (name: string) => void state.jar.delete(name),
  }),
}));
vi.mock("@/env", () => ({ env: { AUTH_SECRET: "f".repeat(32), NODE_ENV: "test" } }));
vi.mock("@/server/db", () => ({
  db: new Proxy({}, { get: (_t, key) => (state.db as Record<PropertyKey, unknown>)[key] }),
}));

vi.mock("@/server/limiter", () => ({
  limit: async (action: string, subject: string) => {
    state.limitCalls.push([action, subject]);
    return { ok: !state.limited, retryAfterMs: state.limited ? 1_000 : 0 };
  },
}));

const { saveClerkOutfit } = await import("../index");

const OUTFIT: Outfit = {
  hair: "bowl",
  glasses: "monocle",
  hat: "ushanka",
  clothes: "braces",
  face: "beard",
  hairCol: "#8C8A84",
};

// Records every write asked of a real client (a Proxy: Prisma 7 delegates are lazy getters).
const WRITES = /^(create|upsert|update|delete)/;
function recordWrites<T extends object>(client: T) {
  const writes: string[] = [];
  const bind = (target: object, key: PropertyKey) => {
    const value = Reflect.get(target, key, target) as unknown;
    return typeof value === "function" ? value.bind(target) : value;
  };
  const db = new Proxy(client, {
    get(target, key) {
      const value = bind(target, key);
      if (typeof key !== "string") return value;
      if (key.startsWith("$executeRaw") || key === "$transaction") {
        return (...args: unknown[]) => (
          writes.push(key),
          (value as (...a: unknown[]) => unknown)(...args)
        );
      }
      if (key.startsWith("$") || value === null || typeof value !== "object") return value;
      return new Proxy(value, {
        get(delegate, method) {
          const fn = bind(delegate, method);
          if (typeof method !== "string" || !WRITES.test(method) || typeof fn !== "function") {
            return fn;
          }
          return (...args: unknown[]) => (writes.push(`${key}.${method}`), fn(...args));
        },
      });
    },
  });
  return { db, writes };
}

describe("saveClerkOutfit (unit, fake DB)", () => {
  const update = vi.fn();
  const findUnique = vi.fn();
  beforeEach(() => {
    state.jar.clear();
    state.limited = false;
    state.limitCalls = [];
    update.mockReset();
    findUnique.mockReset();
    state.db = { user: { update, findUnique, create: vi.fn(), upsert: vi.fn() } };
  });

  it.each([
    ["null", null],
    ["a string", "side"],
    ["a missing slot", { ...OUTFIT, face: undefined }],
    ["an unknown id", { ...OUTFIT, hat: "crown" }],
    ["an unknown colour", { ...OUTFIT, hairCol: "red" }],
  ])("C4: %s is invalid and touches no database, viewer or not", async (_name, input) => {
    state.jar.set(GUEST_COOKIE, { value: signGuestCookie("u1", SECRET) });
    await expect(saveClerkOutfit(input)).resolves.toEqual({ saved: false, reason: "invalid" });
    expect(update).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("C4: without a viewer nothing is written and no cookie is set", async () => {
    await expect(saveClerkOutfit(OUTFIT)).resolves.toEqual({ saved: false, reason: "no-viewer" });
    expect(update).not.toHaveBeenCalled();
    expect(state.jar.size).toBe(0);
    expect(state.limitCalls).toEqual([]);
  });

  it("counts a viewer's save against their clerk-outfit limit; over it nothing is written", async () => {
    state.jar.set(GUEST_COOKIE, { value: signGuestCookie("u1", SECRET) });
    findUnique.mockResolvedValue({
      id: "u1",
      typistName: "Ada",
      isGuest: true,
      avatarStatus: null,
    });
    state.limited = true;
    await expect(saveClerkOutfit(OUTFIT)).resolves.toEqual({
      saved: false,
      reason: "rate-limited",
    });
    expect(state.limitCalls).toEqual([["clerk-outfit", "user:u1"]]);
    expect(update).not.toHaveBeenCalled();
  });

  it("invalid input is refused before the limit is counted", async () => {
    state.jar.set(GUEST_COOKIE, { value: signGuestCookie("u1", SECRET) });
    await saveClerkOutfit({ ...OUTFIT, hat: "crown" });
    expect(state.limitCalls).toEqual([]);
  });
});

describe.skipIf(!testDatabaseUrl)(
  "saveClerkOutfit (integration, needs TEST_DATABASE_URL)",
  { timeout: 15_000 },
  () => {
    let client: ReturnType<typeof createPrismaClient>;
    const created: string[] = [];

    beforeAll(async () => {
      client = createPrismaClient(testDatabaseUrl!);
      await client.$connect();
    }, 30_000);
    beforeEach(() => {
      state.jar.clear();
      state.limited = false;
      state.limitCalls = [];
    });
    afterAll(async () => {
      await client.user.deleteMany({ where: { id: { in: created } } });
      await client.$disconnect();
    });

    async function guest() {
      const user = await client.user.create({
        data: { typistName: `Outfit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
        select: { id: true },
      });
      created.push(user.id);
      return user.id;
    }

    it("C4: a viewer's outfit is stored on their own row, unknown keys stripped", async () => {
      const id = await guest();
      const other = await guest();
      state.jar.set(GUEST_COOKIE, { value: signGuestCookie(id, SECRET) });
      const { db, writes } = recordWrites(client);
      state.db = db;

      await expect(saveClerkOutfit({ ...OUTFIT, id: other, extra: 1 })).resolves.toEqual({
        saved: true,
      });
      expect(writes).toEqual(["user.update"]);
      const rows = await client.user.findMany({
        where: { id: { in: [id, other] } },
        select: { id: true, outfit: true },
      });
      expect(rows.find((r) => r.id === id)?.outfit).toEqual(OUTFIT);
      expect(rows.find((r) => r.id === other)?.outfit).toBeNull();
      expect(state.jar.get(GUEST_COOKIE)?.options).toBeUndefined();
    });

    it("C4: no viewer creates no User row, makes no write and sets no cookie", async () => {
      const { db, writes } = recordWrites(client);
      state.db = db;
      await expect(saveClerkOutfit(OUTFIT)).resolves.toEqual({
        saved: false,
        reason: "no-viewer",
      });
      // A forged cookie is no viewer either.
      state.jar.set(GUEST_COOKIE, { value: "forged.value" });
      await expect(saveClerkOutfit(OUTFIT)).resolves.toEqual({
        saved: false,
        reason: "no-viewer",
      });
      expect(writes).toEqual([]);
      // getViewer clears an invalid guest cookie (guest.ts); nothing is ever set.
      expect(state.jar.get(GUEST_COOKIE)).toBeUndefined();
    });

    it("a save over the viewer's clerk-outfit limit makes no write", async () => {
      const id = await guest();
      state.jar.set(GUEST_COOKIE, { value: signGuestCookie(id, SECRET) });
      const { db, writes } = recordWrites(client);
      state.db = db;
      await expect(saveClerkOutfit(OUTFIT)).resolves.toEqual({ saved: true });
      state.limited = true;
      await expect(saveClerkOutfit({ ...OUTFIT, hat: "beret" })).resolves.toEqual({
        saved: false,
        reason: "rate-limited",
      });
      expect(state.limitCalls).toEqual([
        ["clerk-outfit", `user:${id}`],
        ["clerk-outfit", `user:${id}`],
      ]);
      expect(writes).toEqual(["user.update"]);
      const row = await client.user.findUnique({ where: { id }, select: { outfit: true } });
      expect(row?.outfit).toEqual(OUTFIT);
    });

    it("C4: invalid input makes no write for a real viewer", async () => {
      const id = await guest();
      state.jar.set(GUEST_COOKIE, { value: signGuestCookie(id, SECRET) });
      const { db, writes } = recordWrites(client);
      state.db = db;
      await expect(saveClerkOutfit({ ...OUTFIT, hair: "mohawk" })).resolves.toEqual({
        saved: false,
        reason: "invalid",
      });
      expect(writes).toEqual([]);
      const row = await client.user.findUnique({ where: { id }, select: { outfit: true } });
      expect(row?.outfit).toBeNull();
    });
  },
);
