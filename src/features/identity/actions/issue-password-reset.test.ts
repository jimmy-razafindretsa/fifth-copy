import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "@/server/db-client";
import type { Viewer } from "@/server/auth";

// #788 C3-C6: the host-issued reset code against the test database (ADR 0003). The viewer and the
// limiter are injected; the limiter itself is tested on real Redis (src/server/limiter/index.test.ts).
// eslint-disable-next-line no-restricted-properties
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

const state = vi.hoisted(() => ({
  db: null as unknown,
  viewer: null as Viewer | null,
  limited: false,
  calls: [] as string[],
}));

vi.mock("@/env", () => ({ env: { NODE_ENV: "test", AUTH_SECRET: "p".repeat(32) } }));
vi.mock("@/server/db", () => ({
  db: new Proxy({}, { get: (_t, key) => (state.db as Record<PropertyKey, unknown>)[key] }),
}));
// Only the viewer is faked; the Argon2id functions are the real ones of #38.
vi.mock("@/server/auth", async () => {
  const password = await import("@/server/auth/password");
  return {
    getViewer: async () => {
      state.calls.push("viewer");
      return state.viewer;
    },
    hashPassword: password.hashPassword,
    verifyPassword: password.verifyPassword,
  };
});
vi.mock("@/server/limiter", () => ({
  limit: async (action: string, subject: string) => {
    state.calls.push(`limit:${action}:${subject}`);
    return { ok: !state.limited, retryAfterMs: state.limited ? 42_000 : 0 };
  },
}));

const PREFIX = `test-reset-${randomUUID().slice(0, 8)}-`;
const viewerOf = (id: string, isGuest = false): Viewer => ({
  id,
  name: "Host",
  isGuest,
  hasAvatar: false,
});

describe.skipIf(!testDatabaseUrl)("issuePasswordReset (needs TEST_DATABASE_URL)", () => {
  let db: ReturnType<typeof createPrismaClient>;
  let issuePasswordReset: typeof import("./issue-password-reset").issuePasswordReset;
  let verifyPassword: typeof import("@/server/auth/password").verifyPassword;
  const ids: Record<string, string> = {};
  const raceIds: string[] = [];
  // Room codes unique to this run (3 letters without I/O, 4 digits).
  const digits = String(Math.floor(Math.random() * 9000) + 1000);
  const CODE_A = `QRT-${digits}`;
  const CODE_B = `QRW-${digits}`;
  const CODE_OTHER = `QRX-${digits}`;

  const user = async (
    key: string,
    opts: { isGuest?: boolean; password?: boolean; username?: string } = {},
  ) => {
    const name = `${PREFIX}${key}`;
    const row = await db.user.create({
      data: {
        typistName: name,
        isGuest: opts.isGuest ?? false,
        username: opts.username ?? name,
        usernameNormalized: (opts.username ?? name).toLowerCase(),
        passwordHash: opts.password === false ? null : "$argon2id$v=19$m=19456,t=2,p=1$x$y",
      },
    });
    ids[key] = row.id;
    return row.id;
  };

  const raced = async (lobbyId: string, userId: string) => {
    const race = await db.race.create({
      data: {
        lobbyId,
        textContent: "a b",
        textLanguage: "EN",
        textWordCount: 2,
        settings: {},
        startedAt: new Date(),
        engineVersion: "test",
        protocolVersion: 1,
      },
    });
    raceIds.push(race.id);
    const n = { wpm: 50, rawWpm: 50, cleanWpm: 50, adjustedWpm: 50, accuracy: 1, progress: 1 };
    await db.raceResult.create({
      data: {
        raceId: race.id,
        userId,
        desk: 1,
        name: "Student",
        isBot: false,
        place: 1,
        status: "FINISHED",
        ...n,
        correct: 3,
        errors: 0,
        total: 3,
        durationMs: 1000,
        bonusesSent: 0,
        bonusesReceived: 0,
        bonusLog: [],
        engineVersion: "test",
      },
    });
  };

  // Users are counted by this run's prefix only: other suites share the test database.
  const counts = async () => ({
    resets: await db.passwordReset.count({ where: { user: { typistName: { startsWith: PREFIX } } } }),
    issued: await db.passwordReset.count({ where: { issuedBy: { typistName: { startsWith: PREFIX } } } }),
    users: await db.user.count({ where: { typistName: { startsWith: PREFIX } } }),
  });

  const cleanup = async () => {
    await db.race.deleteMany({ where: { id: { in: raceIds } } });
    await db.user.deleteMany({ where: { typistName: { startsWith: PREFIX } } });
  };

  beforeAll(async () => {
    db = createPrismaClient(testDatabaseUrl!);
    state.db = db;
    ({ issuePasswordReset } = await import("./issue-password-reset"));
    ({ verifyPassword } = await import("@/server/auth/password"));
    await user("host");
    await user("otherHost");
    await user("student");
    await user("studentElsewhere"); // raced only under another host
    await user("studentB"); // raced only in the host's second lobby
    await user("never"); // never raced
    await user("guest", { isGuest: true });
    await user("noPassword", { password: false });
    const lobbyA = await db.lobby.create({ data: { code: CODE_A, hostUserId: ids.host! } });
    const lobbyB = await db.lobby.create({ data: { code: CODE_B, hostUserId: ids.host! } });
    const other = await db.lobby.create({ data: { code: CODE_OTHER, hostUserId: ids.otherHost! } });
    await raced(lobbyA.id, ids.student!);
    await raced(lobbyA.id, ids.guest!);
    await raced(lobbyA.id, ids.noPassword!);
    await raced(lobbyA.id, ids.host!);
    await raced(lobbyB.id, ids.studentB!);
    await raced(other.id, ids.studentElsewhere!);
  });

  afterAll(async () => {
    await cleanup();
    await db.$disconnect();
  });

  beforeEach(async () => {
    state.viewer = viewerOf(ids.host!);
    state.limited = false;
    state.calls = [];
    await db.passwordReset.deleteMany({ where: { user: { typistName: { startsWith: PREFIX } } } });
  });

  const name = (key: string) => `${PREFIX}${key}`;

  describe("C3: input and host", () => {
    it.each([
      ["no object", null],
      ["a malformed room code", { code: "KGB4821!", username: "x" }],
      ["a lower-case room code", { code: "qrt-1234", username: "x" }],
      ["an empty username", { code: "QRT-1234", username: "   " }],
      ["a huge username", { code: "QRT-1234", username: "a".repeat(300) }],
      ["a non-string username", { code: "QRT-1234", username: 12 }],
    ])("%s is invalid before anything is read", async (_n, input) => {
      const before = await counts();
      expect(await issuePasswordReset(input as never)).toEqual({ ok: false, error: "invalid" });
      expect(state.calls).toEqual([]);
      expect(await counts()).toEqual(before);
    });

    it.each([
      ["no viewer", () => null],
      ["a guest viewer", () => viewerOf(ids.guest!, true)],
      ["an account that is not the lobby's host", () => viewerOf(ids.otherHost!)],
      ["the host's id flagged as a guest", () => viewerOf(ids.host!, true)],
    ])("%s gets not-host, writes nothing and creates no guest", async (_n, viewer) => {
      state.viewer = viewer();
      const before = await counts();
      expect(await issuePasswordReset({ code: CODE_A, username: name("student") })).toEqual({
        ok: false,
        error: "not-host",
      });
      expect(await counts()).toEqual(before);
      expect(state.calls.some((c) => c.startsWith("limit:"))).toBe(false);
    });

    it("an unknown room code gets not-host", async () => {
      expect(await issuePasswordReset({ code: "ZZZ-0000", username: name("student") })).toEqual({
        ok: false,
        error: "not-host",
      });
    });
  });

  describe("C4: one not-eligible answer", () => {
    it.each([
      ["an unknown username", () => `${PREFIX}nobody`],
      ["a guest row", () => name("guest")],
      ["an account without a password", () => name("noPassword")],
      ["the host's own account", () => name("host")],
      ["an account that never raced", () => name("never")],
      ["an account that raced only under another host", () => name("studentElsewhere")],
    ])("%s", async (_n, username) => {
      const before = await counts();
      expect(await issuePasswordReset({ code: CODE_A, username: username() })).toEqual({
        ok: false,
        error: "not-eligible",
      });
      expect(await counts()).toEqual(before);
    });

    it("a student who raced in any lobby of the host is eligible, not only the named one", async () => {
      const result = await issuePasswordReset({ code: CODE_A, username: name("studentB") });
      expect(result.ok).toBe(true);
    });

    it("the username is matched case-insensitively (normalizeUsername)", async () => {
      const result = await issuePasswordReset({
        code: CODE_A,
        username: `  ${name("student").toUpperCase()} `,
      });
      expect(result.ok).toBe(true);
    });
  });

  describe("C5: success", () => {
    it("returns the code once and stores only its Argon2id hash with the audit fields", async () => {
      const result = await issuePasswordReset({ code: CODE_A, username: name("student") });
      if (!result.ok) throw new Error(`expected ok, got ${result.error}`);
      expect(result.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
      const rows = await db.passwordReset.findMany({ where: { userId: ids.student! } });
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.issuedByUserId).toBe(ids.host);
      expect(row.lobbyCode).toBe(CODE_A);
      expect(row.usedAt).toBeNull();
      expect(row.expiresAt.getTime() - row.issuedAt.getTime()).toBe(30 * 60_000);
      expect(result.expiresAt.getTime()).toBe(row.expiresAt.getTime());
      expect(row.codeHash.startsWith("$argon2id$")).toBe(true);
      expect(await verifyPassword(result.code.replace("-", ""), row.codeHash)).toBe(true);
      const plain = result.code.replace("-", "");
      for (const value of Object.values(row)) {
        expect(String(value)).not.toContain(plain);
        expect(String(value)).not.toContain(result.code);
      }
    });

    it("a second issuance adds a row and leaves the first in place", async () => {
      const first = await issuePasswordReset({ code: CODE_A, username: name("student") });
      const second = await issuePasswordReset({ code: CODE_A, username: name("student") });
      expect(first.ok && second.ok).toBe(true);
      const rows = await db.passwordReset.findMany({
        where: { userId: ids.student! },
        orderBy: { issuedAt: "asc" },
      });
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.usedAt === null)).toBe(true);
      if (first.ok && second.ok) expect(first.code).not.toBe(second.code);
    });
  });

  describe("C6: limiter", () => {
    it("counts per user:<viewer id> after the host check and before the eligibility lookup", async () => {
      await issuePasswordReset({ code: CODE_A, username: name("never") });
      expect(state.calls).toEqual(["viewer", `limit:password-reset-issue:user:${ids.host}`]);
    });

    it("a refused call returns rate-limited with retryAfterMs and writes nothing", async () => {
      state.limited = true;
      const before = await counts();
      expect(await issuePasswordReset({ code: CODE_A, username: name("student") })).toEqual({
        ok: false,
        error: "rate-limited",
        retryAfterMs: 42_000,
      });
      expect(await counts()).toEqual(before);
    });

  });
});
