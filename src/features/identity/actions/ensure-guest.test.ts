import "dotenv/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { createPrismaClient } from "@/server/db-client";
import { GUEST_COOKIE, signGuestCookie } from "@/server/auth/guest-cookie";
import { TYPIST_WORDS } from "../guest/names";

// ADR 0003: DB-backed tests target the test database, not the app env.
// eslint-disable-next-line no-restricted-properties
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const SECRET = "e".repeat(32);

type Cookie = { value: string; options?: Record<string, unknown> };
type Row = { id: string; typistName: string; isGuest: boolean; avatarStatus: "NONE" };
type Db = { user: Record<string, (...args: never[]) => unknown> };

// One browser cookie jar shared by every "request"; db and NODE_ENV swappable per test.
const state = vi.hoisted(() => ({
  jar: new Map<string, { value: string; options?: Record<string, unknown> }>(),
  db: null as unknown,
  nodeEnv: "test" as string,
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
vi.mock("@/env", () => ({
  env: {
    AUTH_SECRET: "e".repeat(32),
    get NODE_ENV() {
      return state.nodeEnv;
    },
  },
}));
vi.mock("@/server/db", () => ({
  db: new Proxy({}, { get: (_t, key) => (state.db as Record<PropertyKey, unknown>)[key] }),
}));

const { ensureGuest, getViewer } = await import("../index");

// In-memory User table with the real unique index on typistName.
function fakeDb() {
  const rows: Row[] = [];
  let next = 0;
  const user = {
    create: vi.fn(async ({ data }: { data: { typistName: string } }) => {
      if (rows.some((r) => r.typistName === data.typistName)) {
        throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "test",
        });
      }
      const row: Row = {
        id: `fake${next++}`,
        typistName: data.typistName,
        isGuest: true,
        avatarStatus: "NONE",
      };
      rows.push(row);
      return { id: row.id, typistName: row.typistName };
    }),
    findUnique: vi.fn(
      async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id) ?? null,
    ),
  };
  return { rows, db: { user } satisfies Db };
}

const cookie = (): Cookie | undefined => state.jar.get(GUEST_COOKIE);

describe("ensureGuest (unit, fake DB)", () => {
  let fake: ReturnType<typeof fakeDb>;

  beforeEach(() => {
    state.jar.clear();
    state.nodeEnv = "test";
    fake = fakeDb();
    state.db = fake.db;
    vi.restoreAllMocks();
  });

  it("C2: creates one guest per browser; a second call with the same jar returns the same id", async () => {
    const first = await ensureGuest();
    const second = await ensureGuest();
    expect(first).toEqual({
      id: "fake0",
      name: expect.stringMatching(/^[^\s-]+-\d{3}$/u),
      isGuest: true,
      hasAvatar: false,
    });
    expect(second).toEqual(first);
    expect(fake.rows).toHaveLength(1);
    expect(fake.db.user.create).toHaveBeenCalledTimes(1);
  });

  it("C2: sets a signed HttpOnly, SameSite=Lax, one-year, Path=/ cookie, not Secure outside production", async () => {
    const guest = await ensureGuest();
    expect(cookie()).toEqual({
      value: signGuestCookie(guest.id, SECRET),
      options: { httpOnly: true, sameSite: "lax", path: "/", maxAge: 31536000, secure: false },
    });
  });

  it("C2: the cookie is Secure when NODE_ENV=production", async () => {
    state.nodeEnv = "production";
    await ensureGuest();
    expect(cookie()?.options).toMatchObject({ secure: true, httpOnly: true });
  });

  it("C3: getViewer without a guest-creating write never inserts a row", async () => {
    await expect(getViewer()).resolves.toBeNull();
    state.jar.set(GUEST_COOKIE, { value: "forged.value" });
    await expect(getViewer()).resolves.toBeNull();
    expect(fake.db.user.create).not.toHaveBeenCalled();
    expect(fake.rows).toHaveLength(0);
  });

  it.each([
    ["tampered", () => `fake9.${signGuestCookie("fake0", SECRET).split(".")[1]}`],
    ["unsigned", () => "fake0"],
    ["unknown-id", () => signGuestCookie("nobody", SECRET)],
  ])(
    "C3/C9: a %s cookie resolves to no viewer; ensureGuest creates a new guest and replaces it",
    async (_l, value) => {
      await ensureGuest(); // fake0 exists, so the tampered/unsigned values point at a real row
      state.jar.set(GUEST_COOKIE, { value: value() });
      await expect(getViewer()).resolves.toBeNull();

      const fresh = await ensureGuest();
      expect(fresh.id).toBe("fake1");
      expect(cookie()?.value).toBe(signGuestCookie("fake1", SECRET));
      await expect(getViewer()).resolves.toEqual(fresh);
    },
  );

  it("C4: name collisions retry and fall back to a 4-digit suffix; the unique index never surfaces", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    fake.rows.push({
      id: "taken",
      typistName: `${TYPIST_WORDS[0]}-100`,
      isGuest: true,
      avatarStatus: "NONE",
    });
    const guest = await ensureGuest();
    expect(guest.name).toBe(`${TYPIST_WORDS[0]}-1000`);
    expect(fake.db.user.create).toHaveBeenCalledTimes(6);
  });

  it("propagates non-collision DB errors", async () => {
    fake.db.user.create.mockRejectedValueOnce(new Error("connection lost"));
    await expect(ensureGuest()).rejects.toThrow("connection lost");
    expect(cookie()).toBeUndefined();
  });
});

describe.skipIf(!testDatabaseUrl)("ensureGuest (integration, needs TEST_DATABASE_URL)", () => {
  let db: ReturnType<typeof createPrismaClient>;
  const created: string[] = [];

  beforeAll(() => {
    db = createPrismaClient(testDatabaseUrl!);
  });
  beforeEach(() => {
    state.jar.clear();
    state.nodeEnv = "test";
    state.db = db;
  });
  afterAll(async () => {
    await db.user.deleteMany({ where: { id: { in: created } } });
    await db.$disconnect();
  });

  it("C6: ensureGuest, then getViewer in a second request carrying the cookie, returns the same guest", async () => {
    const guest = await ensureGuest();
    created.push(guest.id);
    const row = await db.user.findUniqueOrThrow({ where: { id: guest.id } });
    expect(row).toMatchObject({ isGuest: true, typistName: guest.name });

    const viewer = await getViewer(); // same jar = second request from the same browser
    expect(viewer).toEqual({ id: guest.id, name: row.typistName, isGuest: true, hasAvatar: false });
    await expect(ensureGuest()).resolves.toEqual(viewer);
  });

  it("C3: getViewer never inserts a row, with or without a (bad) cookie", async () => {
    const before = await db.user.count();
    await getViewer();
    state.jar.set(GUEST_COOKIE, { value: signGuestCookie("no-such-user", SECRET) });
    await getViewer();
    state.jar.set(GUEST_COOKIE, { value: "tampered.cookie" });
    await getViewer();
    expect(await db.user.count()).toBe(before);
  });

  it("C9: an unknown-id cookie is replaced by a freshly signed cookie for a new guest", async () => {
    state.jar.set(GUEST_COOKIE, { value: signGuestCookie("no-such-user", SECRET) });
    const guest = await ensureGuest();
    created.push(guest.id);
    expect(cookie()?.value).toBe(signGuestCookie(guest.id, SECRET));
  });
});
