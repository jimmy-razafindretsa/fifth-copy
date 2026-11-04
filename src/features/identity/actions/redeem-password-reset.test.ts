import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "@/server/db-client";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { form } from "../testing/auth-harness";

// #789 C1-C4: redeeming a teacher reset code against the test database (ADR 0003). The locale, the
// client subject and the limiter are injected (the limiter counts in memory with the real LIMITS
// rule; the Redis window itself is src/server/limiter/index.test.ts); Argon2id is the real one.
// eslint-disable-next-line no-restricted-properties
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

const state = vi.hoisted(() => ({
  db: null as unknown,
  locale: "en" as "en" | "fr",
  subject: "ip:203.0.113.9",
  /** Limiter calls (`<action>:<subject>`), in order, and the attempts counted per key. */
  limits: [] as string[],
  counted: new Map<string, number>(),
  /** Argon2id comparisons run (`verifyPassword`). */
  compares: 0,
  /** Model delegate calls (`user.findUnique`), in order; `fail` makes the named one throw. */
  queries: [] as string[],
  fail: null as string | null,
}));

vi.mock("@/env", () => ({ env: { NODE_ENV: "test", AUTH_SECRET: "r".repeat(32) } }));
vi.mock("@/server/db", () => ({
  db: new Proxy({}, { get: (_t, key) => (state.db as Record<PropertyKey, unknown>)[key] }),
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
      const n = (state.counted.get(key) ?? 0) + 1;
      state.counted.set(key, n);
      const ok = n <= LIMITS[action].max;
      return { ok, retryAfterMs: ok ? 0 : 1_800_000 };
    },
  };
});

const PREFIX = `rr${randomUUID().slice(0, 6)}`;
const OLD_PASSWORD = "old-password-1";
const NEW_PASSWORD = "brand-new-pass-2";
const CODE = "K7QM3XRT";
const OLD_CODE = "ABCD2345";
const MINUTE = 60_000;

describe.skipIf(!testDatabaseUrl)("redeemPasswordReset (needs TEST_DATABASE_URL)", () => {
  let db: ReturnType<typeof createPrismaClient>;
  let redeem: typeof import("./redeem-password-reset").redeemPasswordReset;
  let hashPassword: typeof import("@/server/auth/password").hashPassword;
  let verifyPassword: typeof import("@/server/auth/password").verifyPassword;
  let verifyCredentials: typeof import("@/server/auth/credentials").verifyCredentials;
  let codeHash: string;
  let oldCodeHash: string;
  let oldPasswordHash: string;
  const ids: Record<string, string> = {};
  let serial = 0;

  /** A fresh account (3-20 chars of [a-z0-9_]) with the old password; returns its username. */
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
    ids[username] = row.id;
    await db.recoveryCode.create({ data: { userId: row.id, codeHash: "$argon2id$recovery" } });
    return username;
  };

  const issue = (
    username: string,
    opts: { hash?: string; issuedAt?: Date; expiresAt?: Date; usedAt?: Date } = {},
  ) => {
    const issuedAt = opts.issuedAt ?? new Date(Date.now() - MINUTE);
    return db.passwordReset.create({
      data: {
        userId: ids[username]!,
        codeHash: opts.hash ?? codeHash,
        lobbyCode: "QRT-1234",
        issuedAt,
        expiresAt: opts.expiresAt ?? new Date(issuedAt.getTime() + 30 * MINUTE),
        usedAt: opts.usedAt ?? null,
      },
    });
  };

  const attempt = (username: string, code = CODE, password = NEW_PASSWORD) =>
    redeem(form({ username, code, password }));

  /** Everything the redeem may write, for one account. */
  const snapshot = async (username: string) => ({
    user: await db.user.findUniqueOrThrow({
      where: { id: ids[username]! },
      select: { passwordHash: true, tokenVersion: true },
    }),
    resets: await db.passwordReset.findMany({
      where: { userId: ids[username]! },
      orderBy: { issuedAt: "asc" },
      select: { id: true, usedAt: true },
    }),
    recovery: await db.recoveryCode.findUnique({ where: { userId: ids[username]! } }),
  });

  beforeAll(async () => {
    db = createPrismaClient(testDatabaseUrl!);
    state.db = new Proxy(db, {
      get(target, model) {
        const delegate = Reflect.get(target, model, target) as unknown;
        if (typeof model !== "string" || model.startsWith("$") || typeof delegate !== "object") {
          if (model === "$transaction") state.queries.push("$transaction");
          return typeof delegate === "function" ? delegate.bind(target) : delegate;
        }
        return new Proxy(delegate as object, {
          get(d, method) {
            const fn = Reflect.get(d, method, d) as unknown;
            if (typeof method !== "string" || typeof fn !== "function") return fn;
            return (...args: unknown[]) => {
              const key = `${model}.${method}`;
              state.queries.push(key);
              if (state.fail === key) return Promise.reject(new Error("lookup failed"));
              return (fn as (...a: unknown[]) => unknown).apply(d, args);
            };
          },
        });
      },
    });
    ({ redeemPasswordReset: redeem } = await import("./redeem-password-reset"));
    ({ hashPassword, verifyPassword } = await import("@/server/auth/password"));
    ({ verifyCredentials } = await import("@/server/auth/credentials"));
    [codeHash, oldCodeHash, oldPasswordHash] = await Promise.all([
      hashPassword(CODE),
      hashPassword(OLD_CODE),
      hashPassword(OLD_PASSWORD),
    ]);
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
    state.queries = [];
    state.fail = null;
  });

  describe("C1: input", () => {
    it.each([
      [
        "an empty form",
        {},
        { username: "usernameRequired", code: "codeRequired", password: "passwordRequired" },
      ],
      [
        "a short username",
        { username: "ab", code: CODE, password: NEW_PASSWORD },
        { username: "usernameLength" },
      ],
      [
        "a username with a dash",
        { username: "a-b-c", code: CODE, password: NEW_PASSWORD },
        { username: "usernameChars" },
      ],
      [
        "a 7-character code",
        { username: "abc", code: "K7QM3XR", password: NEW_PASSWORD },
        { code: "codeFormat" },
      ],
      [
        "a 9-character code",
        { username: "abc", code: "K7QM3XRTA", password: NEW_PASSWORD },
        { code: "codeFormat" },
      ],
      [
        "a code with a non-Crockford I",
        { username: "abc", code: "K7QM3XRI", password: NEW_PASSWORD },
        { code: "codeFormat" },
      ],
      [
        "a code with an O",
        { username: "abc", code: "K7QM-3XRO", password: NEW_PASSWORD },
        { code: "codeFormat" },
      ],
      [
        "a code with a symbol",
        { username: "abc", code: "K7QM*XRT", password: NEW_PASSWORD },
        { code: "codeFormat" },
      ],
      [
        "a short password",
        { username: "abc", code: CODE, password: "short" },
        { password: "passwordLength" },
      ],
      [
        "a 129-character password",
        { username: "abc", code: CODE, password: "p".repeat(129) },
        { password: "passwordLength" },
      ],
    ] as const)("%s: field errors, nothing read or counted", async (_n, fields, expected) => {
      const result = await redeem(form(fields as Record<string, string>));
      expect(result.status).toBe("fields");
      expect(result.fieldErrors).toEqual(
        Object.fromEntries(
          Object.entries(expected).map(([f, key]) => [f, en.auth.reset.errors[key]]),
        ),
      );
      expect(result.formError).toBeNull();
      expect(state.queries).toEqual([]);
      expect(state.limits).toEqual([]);
      expect(state.compares).toBe(0);
    });

    it("errors come in the viewer's locale", async () => {
      state.locale = "fr";
      const result = await redeem(form({ username: "", code: "x", password: "" }));
      expect(result.fieldErrors).toEqual({
        username: fr.auth.reset.errors.usernameRequired,
        code: fr.auth.reset.errors.codeFormat,
        password: fr.auth.reset.errors.passwordRequired,
      });
    });

    it("a field given twice, a file, or an extra field refuses the form", async () => {
      const twice = await redeem(
        form({ username: ["abc", "abd"], code: CODE, password: NEW_PASSWORD }),
      );
      expect(twice.fieldErrors.username).toBe(en.auth.reset.errors.usernameRequired);
      const file = new FormData();
      file.append("username", "abc");
      file.append("code", new Blob([CODE]));
      file.append("password", NEW_PASSWORD);
      expect((await redeem(file)).fieldErrors.code).toBe(en.auth.reset.errors.codeRequired);
      const extra = await redeem(
        form({ username: "abc", code: CODE, password: NEW_PASSWORD, userId: "x" }),
      );
      expect(extra).toMatchObject({ status: "fields", formError: en.auth.reset.errors.fields });
      expect(state.queries).toEqual([]);
    });

    it("never echoes the input", async () => {
      const result = await redeem(form({ username: "a-b-c", code: "ZZZZ-ZZZI", password: "pw" }));
      const text = JSON.stringify(result);
      for (const typed of ["a-b-c", "ZZZZ", "ZZZI"]) expect(text).not.toContain(typed);
    });
  });

  describe("C2: success", () => {
    it("sets the password, bumps tokenVersion and consumes the row in one transaction", async () => {
      const username = await account();
      await issue(username);
      const before = await snapshot(username);
      // as the teacher wrote it: lower case, with the hyphen
      const result = await attempt(username.toUpperCase(), "k7qm-3xrt");
      expect(result).toEqual({ status: "done", fieldErrors: {}, formError: null });
      const after = await snapshot(username);
      expect(await verifyPassword(NEW_PASSWORD, after.user.passwordHash!)).toBe(true);
      expect(after.user.tokenVersion).toBe(before.user.tokenVersion + 1);
      expect(after.resets[0]!.usedAt).toBeInstanceOf(Date);
      expect(after.recovery).toEqual(before.recovery);
      expect(state.queries).toEqual(["user.findUnique", "$transaction"]);
      expect(state.compares).toBe(1);

      expect(await verifyCredentials({ username, password: NEW_PASSWORD })).toMatchObject({
        id: ids[username],
        tokenVersion: before.user.tokenVersion + 1,
      });
      expect(await verifyCredentials({ username, password: OLD_PASSWORD })).toBeNull();
    });

    it("a second redeem of the same code fails and writes nothing", async () => {
      const username = await account();
      await issue(username);
      expect((await attempt(username)).status).toBe("done");
      const after = await snapshot(username);
      const again = await attempt(username, CODE, "another-pass-3");
      expect(again).toEqual({
        status: "invalid",
        fieldErrors: {},
        formError: en.auth.reset.errors.invalid,
      });
      expect(await snapshot(username)).toEqual(after);
    });

    it("two concurrent redeems of one code consume it once", async () => {
      const username = await account();
      await issue(username);
      const results = await Promise.all([
        attempt(username, CODE, "first-pass-11"),
        attempt(username, CODE, "second-pass-22"),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual(["done", "invalid"]);
      const after = await snapshot(username);
      expect(after.user.tokenVersion).toBe(1);
    });
  });

  describe("C3: one generic answer", () => {
    const paths: Array<[string, () => Promise<string>, string?]> = [
      [
        "a wrong code",
        async () => {
          const u = await account();
          await issue(u);
          return u;
        },
        "ZZZZ2222",
      ],
      [
        "an expired row",
        async () => {
          const u = await account();
          await issue(u, { issuedAt: new Date(Date.now() - 31 * MINUTE) });
          return u;
        },
      ],
      [
        "a used row",
        async () => {
          const u = await account();
          await issue(u, { usedAt: new Date() });
          return u;
        },
      ],
      [
        "a code of an older, superseded row",
        async () => {
          const u = await account();
          await issue(u, { issuedAt: new Date(Date.now() - 5 * MINUTE) });
          await issue(u, { hash: oldCodeHash, issuedAt: new Date(Date.now() - MINUTE) });
          return u;
        },
      ],
      ["an account without a row", async () => account()],
      ["an unknown username", async () => `${PREFIX}_nobody`],
      [
        "a guest username",
        async () => {
          const u = await account({ isGuest: true });
          await issue(u);
          return u;
        },
      ],
    ];

    it.each(paths)(
      "%s: invalid, nothing written, one Argon2id comparison",
      async (_n, make, code) => {
        const username = await make();
        const before = ids[username] ? await snapshot(username) : null;
        state.compares = 0;
        expect(await attempt(username, code ?? CODE)).toEqual({
          status: "invalid",
          fieldErrors: {},
          formError: en.auth.reset.errors.invalid,
        });
        expect(state.compares).toBe(1);
        expect(state.queries).toEqual(["user.findUnique"]);
        if (before) expect(await snapshot(username)).toEqual(before);
      },
    );

    it("a failing lookup answers the generic jam and never throws", async () => {
      state.fail = "user.findUnique";
      await expect(attempt(`${PREFIX}_x`)).resolves.toEqual({
        status: "error",
        fieldErrors: {},
        formError: en.auth.reset.errors.generic,
      });
    });

    it("unknown username and wrong code take about the same time (median over 20, < 2x)", async () => {
      const known = await account();
      await issue(known);
      const unknown = `${PREFIX}_ghost`;
      const time = async (username: string) => {
        state.counted.clear();
        const t0 = performance.now();
        await attempt(username, "ZZZZ2222");
        return performance.now() - t0;
      };
      const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
      const a: number[] = [];
      const b: number[] = [];
      for (let i = 0; i < 20; i++) {
        a.push(await time(unknown));
        b.push(await time(known));
      }
      const [ma, mb] = [median(a), median(b)];
      expect(Math.max(ma, mb) / Math.min(ma, mb)).toBeLessThan(2);
    }, 60_000);
  });

  describe("C4: limiter", () => {
    it("counts per reset:<usernameNormalized> and per requestSubject() before any lookup", async () => {
      const username = await account();
      await issue(username);
      state.fail = "user.findUnique";
      await attempt(` ${username.toUpperCase()} `);
      expect(state.limits).toEqual([
        `password-reset-redeem:reset:${username}`,
        `password-reset-redeem:${state.subject}`,
      ]);
    });

    it("the sixth attempt on one account is refused, even from another client, and compares nothing", async () => {
      const username = await account();
      await issue(username);
      for (let i = 0; i < 5; i++) {
        state.subject = `ip:192.0.2.${i}`;
        expect((await attempt(username, "ZZZZ2222")).status).toBe("invalid");
      }
      state.subject = "ip:192.0.2.99";
      state.compares = 0;
      state.queries = [];
      const before = await snapshot(username);
      const sixth = await attempt(username); // the right code
      expect(sixth).toEqual({
        status: "rate-limited",
        fieldErrors: {},
        formError: "Too many tries. Try again in 30 min.",
        retryAfterMs: 1_800_000,
      });
      expect(state.compares).toBe(0);
      expect(state.queries).toEqual([]);
      expect(await snapshot(username)).toEqual(before);
    });

    it("the sixth attempt from one client is refused, whatever the account", async () => {
      const names = await Promise.all([1, 2, 3, 4, 5, 6].map(() => account()));
      for (const u of names.slice(0, 5)) expect((await attempt(u)).status).toBe("invalid");
      state.compares = 0;
      state.queries = [];
      state.locale = "fr";
      const sixth = await attempt(names[5]!);
      expect(sixth).toMatchObject({
        status: "rate-limited",
        formError: "Trop d'essais. Réessaie dans 30 min.",
      });
      expect(state.compares).toBe(0);
      expect(state.queries).toEqual([]);
    });
  });
});
