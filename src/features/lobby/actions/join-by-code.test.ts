import "dotenv/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "@/server/db-client";
import { fakeLobbyDb } from "../testing/fake-db";

// ADR 0003: DB-backed tests target the test database, not the app env.
// eslint-disable-next-line no-restricted-properties
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

const state = vi.hoisted(() => ({
  jar: new Map<string, { value: string }>(),
  db: null as unknown,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const c = state.jar.get(name);
      return c && { name, value: c.value };
    },
    set: (name: string, value: string) => void state.jar.set(name, { value }),
    delete: (name: string) => void state.jar.delete(name),
  }),
}));
vi.mock("@/env", () => ({
  env: { NODE_ENV: "test", AUTH_SECRET: "a".repeat(32), RACE_TOKEN_SECRET: "r".repeat(32) },
}));
vi.mock("@/server/db", () => ({
  db: new Proxy({}, { get: (_t, key) => (state.db as Record<PropertyKey, unknown>)[key] }),
}));

const { joinByCode } = await import("../index");

describe("joinByCode (unit, fake DB)", () => {
  let fake: ReturnType<typeof fakeLobbyDb>;

  beforeEach(() => {
    state.jar.clear();
    fake = fakeLobbyDb();
    state.db = fake.db;
    fake.seedLobby({ code: "KGB-4821", status: "WAITING", hostUserId: "usr_host" });
    fake.seedLobby({ code: "ZRT-1093", status: "CLOSED", hostUserId: "usr_host" });
  });

  it.each([
    ["kgb 4821", { ok: true, code: "KGB-4821" }],
    ["KGB-4821", { ok: true, code: "KGB-4821" }],
    ["KG-1", { ok: false, error: "invalid-format" }],
    ["", { ok: false, error: "invalid-format" }],
    ["KGB-4821".repeat(3), { ok: false, error: "invalid-format" }],
    ["ABC-1234", { ok: false, error: "not-found" }],
    ["zrt1093", { ok: false, error: "closed" }],
  ])("C5: %j -> %j, and inserts no User", async (code, expected) => {
    await expect(joinByCode({ code })).resolves.toEqual(expected);
    expect(fake.db.user.create).not.toHaveBeenCalled();
    expect(state.jar.size).toBe(0);
  });

  it("rejects a non-string code as invalid-format without a lookup", async () => {
    await expect(joinByCode({ code: 4821 } as unknown as { code: string })).resolves.toEqual({
      ok: false,
      error: "invalid-format",
    });
    expect(fake.db.lobby.findUnique).not.toHaveBeenCalled();
  });
});

describe.skipIf(!testDatabaseUrl)(
  "joinByCode (integration, needs TEST_DATABASE_URL)",
  { timeout: 15_000 },
  () => {
    let db: ReturnType<typeof createPrismaClient>;
    const PREFIX = "test-join-";
    // Not KGB-4821: lobby-model.test.ts deletes that code while files run in parallel.
    const OPEN = "JNB-7301";
    const CLOSED = "JNB-7302";
    const cleanup = () => db.user.deleteMany({ where: { typistName: { startsWith: PREFIX } } });

    beforeAll(async () => {
      db = createPrismaClient(testDatabaseUrl!);
      await db.$connect();
      await cleanup();
      const host = await db.user.create({ data: { isGuest: true, typistName: `${PREFIX}host` } });
      await db.lobby.createMany({
        data: [
          { code: OPEN, hostUserId: host.id },
          { code: CLOSED, hostUserId: host.id, status: "CLOSED", closedAt: new Date() },
        ],
      });
    }, 30_000);
    beforeEach(() => {
      state.jar.clear();
      state.db = db;
    });
    afterAll(async () => {
      await cleanup(); // cascades to the lobbies
      await db.$disconnect();
    });

    it("C5: resolves a typed code against the real table; no guest cookie is set", async () => {
      await expect(joinByCode({ code: " jnb 7301 " })).resolves.toEqual({ ok: true, code: OPEN });
      await expect(joinByCode({ code: "JNB-7302" })).resolves.toEqual({
        ok: false,
        error: "closed",
      });
      await expect(joinByCode({ code: "JNB-7309" })).resolves.toEqual({
        ok: false,
        error: "not-found",
      });
      expect(state.jar.size).toBe(0);
    });
  },
);
