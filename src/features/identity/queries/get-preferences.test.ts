import "dotenv/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "@/server/db-client";
import type { Viewer } from "@/server/auth";

// ADR 0003: DB-backed tests target the test database, not the app env.
// eslint-disable-next-line no-restricted-properties
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

const state = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  acceptLanguage: null as string | null,
  db: null as unknown,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = state.jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
  headers: async () =>
    new Headers(state.acceptLanguage ? { "accept-language": state.acceptLanguage } : {}),
}));
vi.mock("@/env", () => ({ env: { AUTH_SECRET: "a".repeat(32), NODE_ENV: "test" } }));
vi.mock("@/server/db", () => ({
  db: new Proxy({}, { get: (_t, key) => (state.db as Record<PropertyKey, unknown>)[key] }),
}));

const { getPreferences } = await import("../index");

describe("getPreferences defaults (#66 C2)", () => {
  beforeEach(() => {
    state.jar.clear();
    state.acceptLanguage = null;
    state.db = { preference: { findUnique: async () => null } };
  });

  it("no viewer: layout null, theme SYSTEM, sound on, locale from the cookie", async () => {
    state.jar.set("locale", "fr");
    await expect(getPreferences(null)).resolves.toEqual({
      layout: null,
      theme: "SYSTEM",
      locale: "fr",
      sound: true,
      machineSkin: "teleprinter",
    });
  });

  it("a viewer with no row gets the same defaults", async () => {
    state.jar.set("locale", "en");
    const viewer: Viewer = { id: "u1", name: "Lynx-101", isGuest: true, hasAvatar: false };
    await expect(getPreferences(viewer)).resolves.toEqual({
      layout: null,
      theme: "SYSTEM",
      locale: "en",
      sound: true,
      machineSkin: "teleprinter",
    });
  });

  it("without a locale cookie the locale is the request's (Accept-Language, then en)", async () => {
    state.acceptLanguage = "fr-CA,fr;q=0.9";
    expect((await getPreferences(null)).locale).toBe("fr");
    state.acceptLanguage = null;
    expect((await getPreferences(null)).locale).toBe("en");
  });
});

describe.skipIf(!testDatabaseUrl)(
  "getPreferences reads the row (integration)",
  { timeout: 15_000 },
  () => {
    let db: ReturnType<typeof createPrismaClient>;
    let viewer: Viewer;

    beforeAll(async () => {
      db = createPrismaClient(testDatabaseUrl!);
      await db.$connect();
      const row = await db.user.create({
        data: { isGuest: true, typistName: `Pref-${Math.random().toString(36).slice(2, 10)}` },
      });
      viewer = { id: row.id, name: row.typistName, isGuest: true, hasAvatar: false };
    }, 30_000);
    beforeEach(() => {
      state.jar.clear();
      state.db = db;
    });
    afterAll(async () => {
      await db.user.delete({ where: { id: viewer.id } });
      await db.$disconnect();
    });

    it("returns the stored values; a null locale falls back to the cookie", async () => {
      await db.preference.create({
        data: { userId: viewer.id, layout: "FR_CA", theme: "DARK", sound: false },
      });
      state.jar.set("locale", "fr");
      await expect(getPreferences(viewer)).resolves.toEqual({
        layout: "FR_CA",
        theme: "DARK",
        locale: "fr",
        sound: false,
        machineSkin: "teleprinter",
      });
      await db.preference.update({ where: { userId: viewer.id }, data: { locale: "EN" } });
      expect((await getPreferences(viewer)).locale).toBe("en");
    });
  },
);
