import "dotenv/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { machineSkinIds } from "@/features/race";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import type { Viewer } from "@/server/auth";
import { createPrismaClient } from "@/server/db-client";
import { PREFERENCE_MACHINE_SKINS, preferencesPatch } from "./schema";

// #638: the machine skin preference. ADR 0003: DB-backed tests target the test database.
// eslint-disable-next-line no-restricted-properties
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

const state = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  db: null as unknown,
  viewer: null as Viewer | null,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (state.jar.has(name) ? { name, value: state.jar.get(name) } : undefined),
    set: (name: string, value: string) => void state.jar.set(name, value),
    delete: (name: string) => void state.jar.delete(name),
  }),
  headers: async () => new Headers(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/env", () => ({ env: { AUTH_SECRET: "a".repeat(32), NODE_ENV: "test" } }));
vi.mock("@/server/db", () => ({
  db: new Proxy({}, { get: (_t, key) => (state.db as Record<PropertyKey, unknown>)[key] }),
}));
vi.mock("@/server/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth")>()),
  getViewer: async () => state.viewer,
}));

const { getPreferences, updatePreferences } = await import("./index");

const noDb = new Proxy(
  {},
  {
    get: () => {
      throw new Error("no db call expected");
    },
  },
);

describe("#638 C1 the machine skin preference", () => {
  beforeEach(() => {
    state.jar.clear();
    state.viewer = null;
    state.db = noDb;
  });

  it("lists exactly the race feature's registered skins", () => {
    expect([...PREFERENCE_MACHINE_SKINS]).toEqual([...machineSkinIds]);
  });

  it("parses a registered skin and refuses an unknown one", () => {
    for (const machineSkin of machineSkinIds) {
      expect(preferencesPatch.parse({ machineSkin })).toEqual({ machineSkin });
    }
    expect(preferencesPatch.safeParse({ machineSkin: "typewriter" }).success).toBe(false);
  });

  it.each([
    [{ machineSkin: "typewriter" }],
    [{ machineSkin: "TELEPRINTER" }],
    [{ machineSkin: null }],
  ])("updatePreferences refuses %j before touching the db", async (patch) => {
    await expect(updatePreferences(patch)).resolves.toEqual({ ok: false, reason: "invalid" });
  });

  it("a visitor without a viewer reads the teleprinter", async () => {
    await expect(getPreferences(null)).resolves.toMatchObject({ machineSkin: "teleprinter" });
  });

  it("a stored skin no longer registered reads the teleprinter", async () => {
    state.db = { preference: { findUnique: async () => ({ sound: true, machineSkin: "gone" }) } };
    const viewer = { id: "u", name: "U", isGuest: true, hasAvatar: false };
    await expect(getPreferences(viewer)).resolves.toMatchObject({ machineSkin: "teleprinter" });
  });
});

describe("#638 C4 catalog lines", () => {
  it.each([
    ["en", en],
    ["fr", fr],
  ] as const)("%s names the section and every registered skin", (_lang, messages) => {
    const machine = messages.settings.machine;
    expect(machine.title).toBeTruthy();
    expect(machine.hint).toBeTruthy();
    for (const id of machineSkinIds) {
      expect((machine.skin as Record<string, string | undefined>)[id], id).toBeTruthy();
    }
    expect(Object.keys(machine.skin).sort()).toEqual([...machineSkinIds].sort());
  });
});

describe.skipIf(!testDatabaseUrl)(
  "#638 C1 updatePreferences files the skin (integration, needs TEST_DATABASE_URL)",
  { timeout: 15_000 },
  () => {
    let db: ReturnType<typeof createPrismaClient>;
    const created: string[] = [];

    beforeAll(async () => {
      db = createPrismaClient(testDatabaseUrl!);
      await db.$connect();
    }, 30_000);
    afterAll(async () => {
      await db.user.deleteMany({ where: { id: { in: created } } });
      await db.$disconnect();
    });

    it("stores the chosen skin on the viewer's row; a new row defaults to teleprinter", async () => {
      state.db = db;
      const row = await db.user.create({
        data: { isGuest: false, typistName: `Skin-${Math.random().toString(36).slice(2, 10)}` },
      });
      created.push(row.id);
      state.viewer = { id: row.id, name: row.typistName, isGuest: false, hasAvatar: false };
      await updatePreferences({ sound: false });
      expect(
        await db.preference.findUnique({
          where: { userId: row.id },
          select: { machineSkin: true },
        }),
      ).toEqual({ machineSkin: "teleprinter" });
      const saved = await updatePreferences({ machineSkin: machineSkinIds[0] });
      expect(saved).toMatchObject({ ok: true, preferences: { machineSkin: machineSkinIds[0] } });
    });
  },
);
