import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { createPrismaClient } from "@/server/db-client";
import {
  AUTH_SECRET,
  form,
  harnessModules,
  newHarness,
  redirectOf,
  reset,
  runId,
  SESSION,
} from "../testing/auth-harness";
import { parseSignUp } from "../schema";

// #36 C1-C4: username sign-up against the test database (ADR 0003). Auth.js, cookies and redirect are
// faked by the harness; Argon2id, the profanity filter and the DB are real. The merge (#56) and its
// flash (#57) are spies: their own tests cover them.
// eslint-disable-next-line no-restricted-properties
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

const h = vi.hoisted(() => ({ harness: null as unknown as ReturnType<typeof newHarness> }));
const spies = vi.hoisted(() => ({
  merge: [] as Array<[string, string]>,
  flashed: [] as unknown[],
  mergeFails: false,
}));

vi.mock("@/env", () => ({ env: { NODE_ENV: "test", AUTH_SECRET: "s".repeat(32) } }));
vi.mock("next/headers", () => harnessModules.headers(h.harness));
vi.mock("next/navigation", () => harnessModules.navigation());
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/server/db", () => harnessModules.db(h.harness));
vi.mock("@/i18n", () => harnessModules.i18n(h.harness));
vi.mock("@/server/auth", () => harnessModules.auth(h.harness));
vi.mock("../merge/merge-guest", () => ({
  mergeGuestInto: async (guest: string, account: string) => {
    spies.merge.push([guest, account]);
    if (spies.mergeFails) throw new Error("boom");
    return { RaceResult: 2 };
  },
}));
vi.mock("../merge/flash", () => ({
  flashMerge: async (counts: unknown) => void spies.flashed.push(counts),
}));

h.harness = newHarness();
const RUN = runId();
const name = (key: string) => `su${RUN}_${key}`; // <= 20 chars, [a-z0-9_]
const PASSWORD = "correct horse battery";

describe.skipIf(!testDatabaseUrl)("signUp (needs TEST_DATABASE_URL)", () => {
  let db: ReturnType<typeof createPrismaClient>;
  let signUp: typeof import("./sign-up").signUp;
  let signGuestCookie: typeof import("@/server/auth/guest-cookie").signGuestCookie;

  const count = () => db.user.count({ where: { typistName: { startsWith: `su${RUN}` } } });

  beforeAll(async () => {
    db = createPrismaClient(testDatabaseUrl!);
    h.harness.db = db;
    ({ signUp } = await import("./sign-up"));
    ({ signGuestCookie } = await import("@/server/auth/guest-cookie"));
  });

  beforeEach(() => {
    reset(h.harness);
    spies.merge.length = 0;
    spies.flashed.length = 0;
    spies.mergeFails = false;
  });

  afterAll(async () => {
    await db.user.deleteMany({ where: { typistName: { startsWith: `su${RUN}` } } });
    await db.user.deleteMany({ where: { typistName: { startsWith: `SU${RUN}` } } });
    await db.$disconnect();
  });

  describe("C1 validation", () => {
    it.each([
      [{ username: "", password: PASSWORD }, "username", en.auth.errors.usernameRequired],
      [{ username: "ab", password: PASSWORD }, "username", en.auth.errors.usernameLength],
      [{ username: "a".repeat(21), password: PASSWORD }, "username", en.auth.errors.usernameLength],
      [{ username: "bad-name", password: PASSWORD }, "username", en.auth.errors.usernameChars],
      [{ username: "émile", password: PASSWORD }, "username", en.auth.errors.usernameChars],
      [{ username: "x y z", password: PASSWORD }, "username", en.auth.errors.usernameChars],
      [{ username: "okname", password: "" }, "password", en.auth.errors.passwordRequired],
      [{ username: "okname", password: "1234567" }, "password", en.auth.errors.passwordLength],
      [
        { username: "okname", password: "p".repeat(129) },
        "password",
        en.auth.errors.passwordLength,
      ],
    ])("%j -> %s error, nothing created", async (fields, field, message) => {
      const state = await signUp(form(fields));
      expect(state.fieldErrors).toEqual({ [field]: message });
      expect(state.formError).toBeNull();
      // other test files write users in parallel: look for this username, not a global count
      const key = fields.username.normalize("NFKC").trim().toLowerCase();
      if (key) expect(await db.user.findUnique({ where: { usernameNormalized: key } })).toBeNull();
      expect(h.harness.signIns).toEqual([]);
    });

    it("answers in the viewer's locale", async () => {
      h.harness.locale = "fr";
      const state = await signUp(form({ username: "ab", password: "1" }));
      expect(state.fieldErrors).toEqual({
        username: fr.auth.errors.usernameLength,
        password: fr.auth.errors.passwordLength,
      });
    });

    it("refuses any other field (no email) and a repeated field; creates nothing", async () => {
      const before = await count();
      const extra = await signUp(
        form({ username: name("extra"), password: PASSWORD, email: "a@b.c" }),
      );
      expect(extra.formError).toBe(en.auth.errors.fields);
      const twice = await signUp(form({ username: [name("twice"), "other"], password: PASSWORD }));
      expect(twice.fieldErrors.username).toBe(en.auth.errors.usernameRequired);
      expect(await count()).toBe(before);
    });

    it("accepts the bounds: 3 and 20 characters, a password of 8 and 128", () => {
      for (const [username, password] of [
        ["Ab_", "p".repeat(8)],
        ["a".repeat(20), "p".repeat(128)],
      ] as const) {
        expect(parseSignUp(form({ username, password }))).toMatchObject({
          ok: true,
          username,
          usernameNormalized: username.toLowerCase(),
        });
      }
    });

    it("keeps the typed case, trims, and lowercases only the unique key", () => {
      expect(parseSignUp(form({ username: "  Comrade_X ", password: PASSWORD }))).toEqual({
        ok: true,
        username: "Comrade_X",
        usernameNormalized: "comrade_x",
        password: PASSWORD,
      });
    });
  });

  describe("C2 taken and profane usernames", () => {
    it("taken is case-insensitive, on the username and on the typist name", async () => {
      await db.user.create({
        data: {
          isGuest: false,
          typistName: name("taken"),
          username: name("taken"),
          usernameNormalized: name("taken"),
        },
      });
      await db.user.create({ data: { isGuest: true, typistName: name("typist") } });
      const before = await count();
      for (const username of [name("taken").toUpperCase(), name("typist").toUpperCase()]) {
        const state = await signUp(form({ username, password: PASSWORD }));
        expect(state.fieldErrors).toEqual({ username: en.auth.errors.usernameTaken });
      }
      expect(await count()).toBe(before);
      h.harness.locale = "fr";
      const state = await signUp(form({ username: name("taken"), password: PASSWORD }));
      expect(state.fieldErrors.username).toBe(fr.auth.errors.usernameTaken);
    });

    it("profane is refused with its own message, in both languages", async () => {
      const state = await signUp(form({ username: "shithead", password: PASSWORD }));
      expect(state.fieldErrors).toEqual({ username: en.auth.errors.usernameRefused });
      h.harness.locale = "fr";
      const frState = await signUp(form({ username: "merde_alors", password: PASSWORD }));
      expect(frState.fieldErrors).toEqual({ username: fr.auth.errors.usernameRefused });
      expect(en.auth.errors.usernameRefused).not.toBe(en.auth.errors.usernameTaken);
      expect(fr.auth.errors.usernameRefused).not.toBe(fr.auth.errors.usernameTaken);
      expect(await db.user.count({ where: { usernameNormalized: "shithead" } })).toBe(0);
    });

    it("the checks run on the server only: no client auth component imports the filter", () => {
      const dir = path.resolve(__dirname, "../components");
      for (const file of ["auth-form.tsx", "provider-buttons.tsx", "guest-cta.tsx"]) {
        const source = readFileSync(path.join(dir, file), "utf8");
        expect(source, file).not.toMatch(/isClean|@\/features\/texts/);
      }
    });
  });

  describe("C3 success", () => {
    it("creates the account, signs in, and redirects; no guest cookie means no merge", async () => {
      const username = `SU${RUN}_Ok`;
      expect(await redirectOf(() => signUp(form({ username, password: PASSWORD })))).toBe(
        "/sign-up/recovery",
      );
      const row = await db.user.findUniqueOrThrow({
        where: { usernameNormalized: username.toLowerCase() },
      });
      expect(row).toMatchObject({
        isGuest: false,
        typistName: username,
        username,
        tokenVersion: 0,
      });
      expect(row.passwordHash).toMatch(/^\$argon2id\$/);
      // #46 C1, C2: the recovery code is stored hashed in the same transaction, the words sealed for the reveal
      const code = await db.recoveryCode.findUniqueOrThrow({ where: { userId: row.id } });
      expect(code.codeHash).toMatch(/^\$argon2id\$/);
      const sealed = h.harness.jar.get("fc_recovery");
      expect(sealed).toMatch(/^[\w-]+(\.[\w-]*){4}$/);
      expect(h.harness.jar.get(SESSION)).toBe(`jwt-for-${row.id}`);
      expect(h.harness.signIns).toEqual([{ provider: "credentials", username, redirect: false }]);
      expect(spies.merge).toEqual([]);
    });

    it("merges a validly signed guest into the account, flashes it and clears the cookie", async () => {
      const guest = await db.user.create({ data: { isGuest: true, typistName: name("guest") } });
      h.harness.viewer = { id: guest.id, name: guest.typistName, isGuest: true, hasAvatar: false };
      h.harness.jar.set("fc_guest", signGuestCookie(guest.id, AUTH_SECRET));
      const username = name("merged");
      expect(await redirectOf(() => signUp(form({ username, password: PASSWORD })))).toBe(
        "/sign-up/recovery",
      );
      const account = await db.user.findUniqueOrThrow({ where: { usernameNormalized: username } });
      expect(spies.merge).toEqual([[guest.id, account.id]]);
      expect(spies.flashed).toEqual([{ RaceResult: 2 }]);
      expect(h.harness.jar.has("fc_guest")).toBe(false);
      expect(h.harness.jar.has(SESSION)).toBe(true);
    });

    it("a forged guest cookie is cleared without a merge", async () => {
      h.harness.jar.set("fc_guest", "someone-else.AAAA");
      const username = name("forged");
      expect(await redirectOf(() => signUp(form({ username, password: PASSWORD })))).toBe(
        "/sign-up/recovery",
      );
      expect(spies.merge).toEqual([]);
      expect(h.harness.deleted).toContain("fc_guest");
    });

    it("a failing merge keeps the guest cookie and still signs in", async () => {
      const guest = await db.user.create({ data: { isGuest: true, typistName: name("guest2") } });
      h.harness.jar.set("fc_guest", signGuestCookie(guest.id, AUTH_SECRET));
      spies.mergeFails = true;
      const username = name("mergefail");
      expect(await redirectOf(() => signUp(form({ username, password: PASSWORD })))).toBe(
        "/sign-up/recovery",
      );
      expect(h.harness.jar.has("fc_guest")).toBe(true);
      expect(h.harness.jar.has(SESSION)).toBe(true);
      expect(spies.flashed).toEqual([]);
    });
  });

  describe("C4 already signed in", () => {
    it("an account gets an error and no second account is created", async () => {
      h.harness.jar.set(SESSION, "jwt");
      h.harness.viewer = { id: "acc", name: "someone", isGuest: false, hasAvatar: false };
      const before = await count();
      const state = await signUp(form({ username: name("second"), password: PASSWORD }));
      expect(state).toEqual({ fieldErrors: {}, formError: en.auth.errors.alreadySignedIn });
      expect(await count()).toBe(before);
      expect(h.harness.signIns).toEqual([]);
    });
  });
});
