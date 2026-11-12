import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "@/server/db-client";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { form } from "../testing/auth-harness";

// #46 C3, C4: redeeming the one-time recovery code against the test database (ADR 0003). The locale,
// the client subject and the limiter are injected (in memory, with the real LIMITS rules); Argon2id
// and the code generator are the real ones.
// eslint-disable-next-line no-restricted-properties
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

const state = vi.hoisted(() => ({
  db: null as unknown,
  locale: "en" as "en" | "fr",
  subject: "ip:203.0.113.9",
  limits: [] as string[],
  counted: new Map<string, number>(),
  compares: 0,
  logs: [] as unknown[][],
}));

vi.mock("@/env", () => ({ env: { NODE_ENV: "test", AUTH_SECRET: "r".repeat(32) } }));
vi.mock("@/server/db", () => ({
  db: new Proxy({}, { get: (_t, key) => (state.db as Record<PropertyKey, unknown>)[key] }),
}));
vi.mock("@/server/logger", () => ({
  logger: new Proxy(
    {},
    {
      get:
        () =>
        (...args: unknown[]) =>
          state.logs.push(args),
    },
  ),
}));
vi.mock("@/i18n", async () => {
  const { en } = await import("@/i18n/en");
  const { fr } = await import("@/i18n/fr");
  const { fill } = await import("@/i18n/format");
  return { fill, getT: async () => (state.locale === "fr" ? fr : en) };
});
vi.mock("@/server/auth", async () => {
  const password = await import("@/server/auth/password");
  return {
    DUMMY_HASH: password.DUMMY_HASH,
    hashPassword: password.hashPassword,
    verifyPassword: async (plain: string, phc: string) => {
      state.compares++;
      return password.verifyPassword(plain, phc);
    },
  };
});
vi.mock("@/server/limiter", async () => {
  const { LIMITS } = await import("@/server/limiter/core");
  return {
    requestSubject: async () => state.subject,
    limit: async (action: keyof typeof LIMITS, subject: string) => {
      const key = `${action}:${subject}`;
      state.limits.push(key);
      const n = state.counted.get(key) ?? 0;
      const ok = n < LIMITS[action].max;
      if (ok) state.counted.set(key, n + 1);
      return { ok, retryAfterMs: ok ? 0 : 1_800_000 };
    },
    clearLimit: async (action: string, subject: string) => {
      state.limits.push(`clear:${action}:${subject}`);
      state.counted.delete(`${action}:${subject}`);
    },
  };
});

const PREFIX = `rc${randomUUID().slice(0, 6)}`;
const OLD_PASSWORD = "old-password-1";
const NEW_PASSWORD = "brand-new-pass-2";

describe.skipIf(!testDatabaseUrl)("redeemRecoveryCode (needs TEST_DATABASE_URL)", () => {
  let db: ReturnType<typeof createPrismaClient>;
  let redeem: typeof import("./redeem-recovery-code").redeemRecoveryCode;
  let issue: typeof import("./issue-recovery-code").issueRecoveryCode;
  let hashPassword: typeof import("@/server/auth/password").hashPassword;
  let verifyCredentials: typeof import("@/server/auth/credentials").verifyCredentials;
  let oldPasswordHash: string;
  let serial = 0;

  /** A fresh account with the old password and a real recovery code; returns its name, id and words. */
  const account = async (opts: { isGuest?: boolean } = {}) => {
    const username = `${PREFIX}_${(serial++).toString(36)}`;
    const row = await db.user.create({
      data: {
        typistName: username,
        isGuest: opts.isGuest ?? false,
        username,
        usernameNormalized: username,
        passwordHash: oldPasswordHash,
      },
    });
    const words = await db.$transaction((tx) => issue(row.id, tx));
    return { username, id: row.id, words };
  };

  const attempt = (username: string, code: string, password = NEW_PASSWORD) =>
    redeem(form({ username, code, password }));

  beforeAll(async () => {
    db = createPrismaClient(testDatabaseUrl!);
    state.db = db;
    ({ redeemRecoveryCode: redeem } = await import("./redeem-recovery-code"));
    ({ issueRecoveryCode: issue } = await import("./issue-recovery-code"));
    ({ hashPassword } = await import("@/server/auth/password"));
    ({ verifyCredentials } = await import("@/server/auth/credentials"));
    oldPasswordHash = await hashPassword(OLD_PASSWORD);
  });

  afterAll(async () => {
    await db.user.deleteMany({ where: { typistName: { startsWith: PREFIX } } });
    await db.$disconnect();
  });

  beforeEach(() => {
    state.locale = "en";
    state.subject = `ip:198.51.100.${serial % 250}`;
    state.limits = [];
    state.counted.clear();
    state.compares = 0;
    state.logs = [];
  });

  describe("C1: storage", () => {
    it("stores only an Argon2id hash, never the words", async () => {
      const { id, words } = await account();
      const row = await db.recoveryCode.findUniqueOrThrow({ where: { userId: id } });
      expect(row.codeHash).toMatch(/^\$argon2id\$/);
      for (const w of words) expect(row.codeHash).not.toContain(w);
      expect(words).toHaveLength(10);
    });
  });

  describe("C3: redeem", () => {
    it("order, case and accents insensitive: sets the password, bumps tokenVersion, rotates and reveals the new code", async () => {
      const { username, id, words } = await account();
      const before = await db.user.findUniqueOrThrow({ where: { id } });
      const oldCode = await db.recoveryCode.findUniqueOrThrow({ where: { userId: id } });
      const typed = [...words]
        .reverse()
        .map((w, i) => (i % 2 ? w.toUpperCase() : w.normalize("NFD").replace(/\p{M}/gu, "")))
        .join("  ");
      const result = await attempt(username.toUpperCase(), typed);
      expect(result.status).toBe("done");
      expect(result.words).toHaveLength(10);
      expect(result.words).not.toEqual(words);

      const after = await db.user.findUniqueOrThrow({ where: { id } });
      expect(after.tokenVersion).toBe(before.tokenVersion + 1);
      expect(await verifyCredentials({ username, password: NEW_PASSWORD })).toMatchObject({ id });
      expect(await verifyCredentials({ username, password: OLD_PASSWORD })).toBeNull();
      const rotated = await db.recoveryCode.findUniqueOrThrow({ where: { userId: id } });
      expect(rotated.codeHash).not.toBe(oldCode.codeHash);
      expect(rotated.rotatedAt).not.toBeNull();

      // the old code is spent; the new one works
      expect((await attempt(username, words.join(" "))).status).toBe("invalid");
      expect((await attempt(username, result.words!.join(" "), "third-pass-3")).status).toBe(
        "done",
      );
      // nothing logged the words or the passwords
      expect(JSON.stringify(state.logs)).not.toMatch(new RegExp(words[0]!));
    });

    it("refuses a malformed form with field errors and compares nothing", async () => {
      const result = await attempt("ab", "acorn lion", "short");
      expect(result.status).toBe("fields");
      expect(result.fieldErrors).toEqual({
        username: en.auth.recovery.errors.usernameLength,
        code: en.auth.recovery.errors.codeFormat,
        password: en.auth.recovery.errors.passwordLength,
      });
      expect(state.compares).toBe(0);
      expect(state.limits).toEqual([]);
    });

    it("answers in French", async () => {
      state.locale = "fr";
      const { username } = await account();
      const wrong = Array(10).fill("acorn").join(" ");
      expect((await attempt(username, wrong)).formError).toBe(fr.auth.recovery.errors.invalid);
    });

    it("two concurrent redeems of one code: exactly one wins", async () => {
      const { username, words } = await account();
      const results = await Promise.all([
        attempt(username, words.join(" ")),
        attempt(username, words.join(" ")),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual(["done", "invalid"]);
    });
  });

  describe("C4: one generic answer, same work", () => {
    const WRONG = Array(10).fill("lion").join(" ");

    it("wrong code, unknown username and guest: the same invalid answer, one comparison each", async () => {
      const known = await account();
      const guest = await account({ isGuest: true });
      const answers = [];
      for (const u of [known.username, `${PREFIX}_ghost`, guest.username]) {
        state.compares = 0;
        answers.push(await attempt(u, u === guest.username ? guest.words.join(" ") : WRONG));
        expect(state.compares).toBe(1);
      }
      for (const a of answers) {
        expect(a).toEqual({
          status: "invalid",
          fieldErrors: {},
          formError: en.auth.recovery.errors.invalid,
        });
      }
    });

    it("unknown username and wrong code take about the same time (median over 20, < 2x)", async () => {
      const { username } = await account();
      const time = async (u: string) => {
        state.counted.clear();
        const t0 = performance.now();
        await attempt(u, WRONG);
        return performance.now() - t0;
      };
      const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
      const a: number[] = [];
      const b: number[] = [];
      for (let i = 0; i < 20; i++) {
        a.push(await time(`${PREFIX}_ghost`));
        b.push(await time(username));
      }
      const [ma, mb] = [median(a), median(b)];
      expect(Math.max(ma, mb) / Math.min(ma, mb)).toBeLessThan(2);
    }, 60_000);
  });

  describe("brute force: client then account budget, before any lookup", () => {
    it("the 6th wrong try on one account is rate-limited and compares nothing; success clears it", async () => {
      const { username, words } = await account();
      const wrong = Array(10).fill("lion").join(" ");
      for (let i = 0; i < 5; i++) expect((await attempt(username, wrong)).status).toBe("invalid");
      state.compares = 0;
      const sixth = await attempt(username, words.join(" "));
      expect(sixth.status).toBe("rate-limited");
      expect(sixth.formError).toBe(en.auth.recovery.errors["rate-limited"].replace("{m}", "30"));
      expect(state.compares).toBe(0);
      expect(state.limits.at(-1)).toBe(`recovery-redeem-account:recovery:${username}`);
    });
  });
});
