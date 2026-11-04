import "dotenv/config";
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

// #36 C5-C7 and the unit half of C15: sign-in and sign-out against the test database (ADR 0003).
// Auth.js, cookies and redirect are faked by the harness (its signIn runs the real verifyCredentials);
// the merge (#56) and its flash (#57) are spies.
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
    return { RaceResult: 3 };
  },
}));
vi.mock("../merge/flash", () => ({
  flashMerge: async (counts: unknown) => void spies.flashed.push(counts),
}));

h.harness = newHarness();
const RUN = runId();
const USERNAME = `si${RUN}_Typist`;
const PASSWORD = "correct horse battery";

describe.skipIf(!testDatabaseUrl)("signIn and signOut (needs TEST_DATABASE_URL)", () => {
  let db: ReturnType<typeof createPrismaClient>;
  let signIn: typeof import("./sign-in").signIn;
  let signOut: typeof import("./sign-out").signOut;
  let uploadAvatar: typeof import("./upload-avatar").uploadAvatar;
  let signGuestCookie: typeof import("@/server/auth/guest-cookie").signGuestCookie;
  let accountId: string;

  beforeAll(async () => {
    db = createPrismaClient(testDatabaseUrl!);
    h.harness.db = db;
    ({ signIn } = await import("./sign-in"));
    ({ signOut } = await import("./sign-out"));
    ({ uploadAvatar } = await import("./upload-avatar"));
    ({ signGuestCookie } = await import("@/server/auth/guest-cookie"));
    const { hashPassword } = await import("@/server/auth/password");
    ({ id: accountId } = await db.user.create({
      data: {
        isGuest: false,
        typistName: USERNAME,
        username: USERNAME,
        usernameNormalized: USERNAME.toLowerCase(),
        passwordHash: await hashPassword(PASSWORD),
      },
    }));
  });

  beforeEach(() => {
    reset(h.harness);
    spies.merge.length = 0;
    spies.flashed.length = 0;
    spies.mergeFails = false;
  });

  afterAll(async () => {
    await db.user.deleteMany({ where: { typistName: { startsWith: `si${RUN}` } } });
    await db.$disconnect();
  });

  const attempt = (fields: Record<string, string>) => signIn(form(fields));

  describe("C5 correct credentials", () => {
    it("sets the session cookie and lands on a same-origin callbackUrl", async () => {
      const to = await redirectOf(() =>
        attempt({ username: USERNAME.toUpperCase(), password: PASSWORD, callbackUrl: "/settings" }),
      );
      expect(to).toBe("/settings");
      expect(h.harness.jar.get(SESSION)).toBe(`jwt-for-${accountId}`);
    });

    it.each([
      ["no callbackUrl", undefined],
      ["protocol-relative", "//evil.example/x"],
      ["absolute", "https://evil.example/"],
      ["backslash", "/\\evil.example"],
      ["scheme", "javascript:alert(1)"],
      ["relative", "settings"],
    ])("%s lands on /", async (_label, callbackUrl) => {
      const fields: Record<string, string> = { username: USERNAME, password: PASSWORD };
      if (callbackUrl !== undefined) fields.callbackUrl = callbackUrl;
      expect(await redirectOf(() => attempt(fields))).toBe("/");
      expect(h.harness.jar.has(SESSION)).toBe(true);
    });
  });

  describe("C6 no enumeration", () => {
    it("wrong password and unknown username get the same generic error, no cookie", async () => {
      const wrong = await attempt({ username: USERNAME, password: `${PASSWORD}!` });
      const unknown = await attempt({ username: `si${RUN}_nobody`, password: PASSWORD });
      expect(wrong).toEqual({ fieldErrors: {}, formError: en.auth.errors.credentials });
      expect(unknown).toEqual(wrong);
      expect(h.harness.jar.has(SESSION)).toBe(false);
      h.harness.locale = "fr";
      const frWrong = await attempt({ username: USERNAME, password: "nope-nope" });
      const frUnknown = await attempt({ username: "nobody_at_all_x", password: "nope-nope" });
      expect(frWrong.formError).toBe(fr.auth.errors.credentials);
      expect(frUnknown).toEqual(frWrong);
    });

    it("a guest row with the name is not an account: the same error", async () => {
      await db.user.create({
        data: {
          isGuest: true,
          typistName: `si${RUN}_guestrow`,
          usernameNormalized: `si${RUN}_guestrow`,
        },
      });
      const state = await attempt({ username: `si${RUN}_guestrow`, password: PASSWORD });
      expect(state.formError).toBe(en.auth.errors.credentials);
    });

    it("empty fields get their own field errors and no lookup", async () => {
      const state = await attempt({ username: " ", password: "" });
      expect(state.fieldErrors).toEqual({
        username: en.auth.errors.usernameRequired,
        password: en.auth.errors.passwordRequired,
      });
      expect(h.harness.signIns).toEqual([]);
    });
  });

  describe("C7 guest merge on sign-in", () => {
    it("merges a validly signed guest into the account and clears the cookie", async () => {
      const guest = await db.user.create({
        data: { isGuest: true, typistName: `si${RUN}_guest` },
      });
      h.harness.jar.set("fc_guest", signGuestCookie(guest.id, AUTH_SECRET));
      expect(await redirectOf(() => attempt({ username: USERNAME, password: PASSWORD }))).toBe("/");
      expect(spies.merge).toEqual([[guest.id, accountId]]);
      expect(spies.flashed).toEqual([{ RaceResult: 3 }]);
      expect(h.harness.jar.has("fc_guest")).toBe(false);
    });

    it("a wrong password never merges", async () => {
      h.harness.jar.set("fc_guest", signGuestCookie("some-guest", AUTH_SECRET));
      await attempt({ username: USERNAME, password: "wrong-password" });
      expect(spies.merge).toEqual([]);
      expect(h.harness.jar.has("fc_guest")).toBe(true);
    });

    it("a failing merge still signs in and keeps the cookie", async () => {
      h.harness.jar.set("fc_guest", signGuestCookie("some-guest", AUTH_SECRET));
      spies.mergeFails = true;
      expect(await redirectOf(() => attempt({ username: USERNAME, password: PASSWORD }))).toBe("/");
      expect(h.harness.jar.has(SESSION)).toBe(true);
      expect(h.harness.jar.has("fc_guest")).toBe(true);
    });
  });

  describe("C15 sign-out", () => {
    it("clears the session cookie; the settings action then rejects a direct call", async () => {
      await redirectOf(() => attempt({ username: USERNAME, password: PASSWORD }));
      h.harness.viewer = { id: accountId, name: USERNAME, isGuest: false, hasAvatar: false };
      expect(h.harness.jar.has(SESSION)).toBe(true);

      expect(await redirectOf(() => signOut())).toBe("/");
      expect(h.harness.jar.has(SESSION)).toBe(false);
      expect(h.harness.deleted).toContain(SESSION);

      const data = form({ crop: JSON.stringify({ x: 0, y: 0, size: 1 }) });
      data.append("file", new Blob([new Uint8Array(4)], { type: "image/png" }));
      await expect(uploadAvatar(data)).rejects.toMatchObject({ name: "UnauthenticatedError" });
    });
  });
});
