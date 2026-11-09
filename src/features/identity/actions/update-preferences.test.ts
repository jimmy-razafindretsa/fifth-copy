import "dotenv/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "@/server/db-client";
import { GUEST_COOKIE } from "@/server/auth/guest-cookie";
import type { Viewer } from "@/server/auth";

// ADR 0003: DB-backed tests target the test database, not the app env.
// eslint-disable-next-line no-restricted-properties
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

// One browser cookie jar per test; the viewer and the db swappable (ensure-guest.test.ts pattern).
const state = vi.hoisted(() => ({
  jar: new Map<string, { value: string; options?: Record<string, unknown> }>(),
  db: null as unknown,
  viewer: null as Viewer | null,
  revalidated: [] as string[],
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
  headers: async () => new Headers(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (p: string, type?: string) => state.revalidated.push(`${p} ${type ?? ""}`.trim()),
}));
vi.mock("@/env", () => ({ env: { AUTH_SECRET: "a".repeat(32), NODE_ENV: "test" } }));
vi.mock("@/server/db", () => ({
  db: new Proxy({}, { get: (_t, key) => (state.db as Record<PropertyKey, unknown>)[key] }),
}));
vi.mock("@/server/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth")>()),
  getViewer: async () => state.viewer,
}));

const { updatePreferences } = await import("../index");
const { refreshPreferenceCookies } = await import("../server");

const YEAR = 60 * 60 * 24 * 365;

describe("updatePreferences validation (#66 C1)", () => {
  beforeEach(() => {
    state.jar.clear();
    state.viewer = null;
    state.db = new Proxy(
      {},
      {
        get: () => {
          throw new Error("no db call expected for an invalid patch");
        },
      },
    );
  });

  it.each([
    [{ layout: "DVORAK" }],
    [{ theme: "dark" }],
    [{ theme: "NIGHT" }],
    [{ locale: "de" }],
    [{ locale: "FR" }],
    [{ sound: "yes" }],
    [{ volume: 3 }],
    [{ layout: "CSA", userId: "someone-else" }],
    [null],
    ["CSA"],
  ])("refuses %j before touching the db or creating a guest", async (patch) => {
    await expect(updatePreferences(patch)).resolves.toEqual({ ok: false, reason: "invalid" });
    expect(state.jar.has(GUEST_COOKIE)).toBe(false);
  });
});

describe.skipIf(!testDatabaseUrl)(
  "updatePreferences and refreshPreferenceCookies (integration, needs TEST_DATABASE_URL)",
  { timeout: 15_000 },
  () => {
    let db: ReturnType<typeof createPrismaClient>;
    const created: string[] = [];

    async function account(): Promise<Viewer> {
      const row = await db.user.create({
        data: { isGuest: false, typistName: `Pref-${Math.random().toString(36).slice(2, 10)}` },
      });
      created.push(row.id);
      return { id: row.id, name: row.typistName, isGuest: false, hasAvatar: false };
    }

    beforeAll(async () => {
      db = createPrismaClient(testDatabaseUrl!);
      await db.$connect();
    }, 30_000);
    beforeEach(() => {
      state.jar.clear();
      state.viewer = null;
      state.revalidated = [];
      state.db = db;
    });
    afterAll(async () => {
      await db.user.deleteMany({ where: { id: { in: created } } });
      await db.$disconnect();
    });

    it("C1 upserts the viewer's row, patch by patch", async () => {
      state.viewer = await account();
      const first = await updatePreferences({ layout: "AZERTY" });
      expect(first).toMatchObject({ ok: true, preferences: { layout: "AZERTY", sound: true } });
      await updatePreferences({ sound: false });
      await updatePreferences({ layout: null });
      const row = await db.preference.findUnique({ where: { userId: state.viewer.id } });
      expect(row).toMatchObject({ layout: null, sound: false, theme: "SYSTEM" });
    });

    it("C1 a visitor with no viewer gets a guest first, and the row is theirs", async () => {
      const result = await updatePreferences({ layout: "CSA" });
      expect(result.ok).toBe(true);
      const cookie = state.jar.get(GUEST_COOKIE)?.value;
      expect(cookie).toBeDefined();
      const guestId = cookie!.slice(0, cookie!.lastIndexOf("."));
      created.push(guestId);
      const guest = await db.user.findUnique({
        where: { id: guestId },
        include: { preference: true },
      });
      expect(guest).toMatchObject({ isGuest: true, preference: { layout: "CSA" } });
    });

    it("C3 theme and locale are mirrored to HttpOnly Lax one-year cookies; SYSTEM clears the theme", async () => {
      state.viewer = await account();
      await updatePreferences({ theme: "DARK", locale: "fr" });
      for (const [name, value] of [
        ["theme", "dark"],
        ["locale", "fr"],
      ] as const) {
        const c = state.jar.get(name);
        expect(c?.value, name).toBe(value);
        expect(c?.options).toMatchObject({
          httpOnly: true,
          sameSite: "lax",
          maxAge: YEAR,
          path: "/",
        });
      }
      expect(state.revalidated).toContain("/ layout");
      await updatePreferences({ theme: "SYSTEM" });
      expect(state.jar.has("theme")).toBe(false);
      // a sound or layout save leaves the cookies alone
      state.jar.set("theme", { value: "light" });
      await updatePreferences({ sound: false });
      expect(state.jar.get("theme")?.value).toBe("light");
      const row = await db.preference.findUnique({ where: { userId: state.viewer.id } });
      expect(row).toMatchObject({ theme: "SYSTEM", locale: "FR", sound: false });
    });

    it("C3 after sign-in the account's row wins over the browser's cookies", async () => {
      const viewer = await account();
      await db.preference.create({ data: { userId: viewer.id, theme: "DARK", locale: "EN" } });
      state.jar.set("theme", { value: "light" });
      state.jar.set("locale", { value: "fr" });
      await refreshPreferenceCookies(viewer.id);
      expect(state.jar.get("theme")).toMatchObject({ value: "dark", options: { httpOnly: true } });
      expect(state.jar.get("locale")?.value).toBe("en");

      await db.preference.update({ where: { userId: viewer.id }, data: { theme: "SYSTEM" } });
      await refreshPreferenceCookies(viewer.id);
      expect(state.jar.has("theme")).toBe(false);
    });

    it("C3 an account with no row keeps the browser's cookies", async () => {
      const viewer = await account();
      state.jar.set("theme", { value: "light" });
      state.jar.set("locale", { value: "fr" });
      await refreshPreferenceCookies(viewer.id);
      expect(state.jar.get("theme")?.value).toBe("light");
      expect(state.jar.get("locale")?.value).toBe("fr");
    });
  },
);
