import "dotenv/config";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextAuthConfig, Profile } from "next-auth";
import type { AdapterUser } from "next-auth/adapters";
import { createPrismaClient } from "@/server/db-client";
import { createAuthAdapter } from "./adapter";
import {
  createOAuthSignInEvent,
  registerOAuthSignInHooks,
  type OAuthSignInHooks,
} from "./oauth-signin";
import { discordProfile, githubProfile } from "./providers";
import { createTypistNameFor } from "./typist-name";

// auth.ts reads the validated env and the app's db client at import; neither is used by these tests
// (the adapter here runs over the test database).
vi.mock("@/env", () => ({ env: { AUTH_SECRET: "x".repeat(64), NODE_ENV: "test" } }));
vi.mock("@/server/db", () => ({ db: {} }));
const { authConfig: config } = await import("./auth");
const authConfig: NextAuthConfig = config;
type SignInEvent = NonNullable<NonNullable<NextAuthConfig["events"]>["signIn"]>;
type JwtCallback = NonNullable<NonNullable<NextAuthConfig["callbacks"]>["jwt"]>;

// #49 C3: the first OAuth sign-in creates the User (typistName = the provider login when it passes
// isClean, else a generated name), links the OAuthAccount and merges the current guest; a second
// sign-in reuses the account. Auth.js's own order is replayed (handle-login.js: getUserByAccount, then
// createUser + linkAccount, then the jwt callback and events.signIn with the raw provider profile and
// isNewUser) over the real adapter, the real auth.ts config and the test database.
// #539: a new account's provider picture is handed to identity's importOauthAvatar (#52) without
// blocking or failing the sign-in, and the picture URL is never stored nor put in the JWT.

// eslint-disable-next-line no-restricted-properties
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)("OAuth sign-in (needs TEST_DATABASE_URL)", () => {
  let db: ReturnType<typeof createPrismaClient>;
  const PREFIX = `oa${randomBytes(3).toString("hex")}`;
  const created = new Set<string>();
  const mergeGuest = vi.fn<OAuthSignInHooks["mergeGuest"]>(async () => {});
  const importAvatar = vi.fn<OAuthSignInHooks["importAvatar"]>(async () => {});
  const hooks: OAuthSignInHooks = {
    isCleanName: (name) => !/darn/i.test(name),
    mergeGuest,
    importAvatar,
  };
  const signInEvent = () => authConfig.events!.signIn as SignInEvent;
  const jwt = () => authConfig.callbacks!.jwt as JwtCallback;

  type Fixture = { id: number; login: string; avatar_url?: string | null };
  type Provider = "github" | "discord";

  /**
   * One Auth.js OAuth callback; returns the signed-in user, whether it was new, and the JWT claims.
   * `raw` is the provider's userinfo response, mapped by the provider's profile() as Auth.js does.
   */
  async function oauthSignIn(provider: Provider, raw: Record<string, unknown>) {
    const adapter = createAuthAdapter({
      db,
      typistNameFor: createTypistNameFor(db, { isClean: hooks.isCleanName }),
    });
    const profile =
      provider === "github"
        ? githubProfile(raw as Parameters<typeof githubProfile>[0])
        : discordProfile(raw as Parameters<typeof discordProfile>[0]);
    const account = {
      provider,
      type: "oauth" as const,
      providerAccountId: profile.id,
      access_token: "dropped",
    };
    let user = await adapter.getUserByAccount!(account);
    let isNewUser = false;
    if (!user) {
      user = await adapter.createUser!({
        ...profile,
        emailVerified: null,
      } as unknown as AdapterUser);
      isNewUser = true;
      created.add(user.id);
      await adapter.linkAccount!({ ...account, userId: user.id });
    }
    const token = await jwt()({
      token: { name: user.name, email: user.email, picture: user.image, sub: user.id },
      user,
      account,
      profile: raw as Profile,
      isNewUser,
      trigger: isNewUser ? "signUp" : "signIn",
    });
    await signInEvent()({ user, account, profile: raw as Profile, isNewUser });
    return { user, isNewUser, token };
  }

  async function signInWithGitHub(fixture: Fixture) {
    return (await oauthSignIn("github", { avatar_url: null, ...fixture })).user;
  }

  const cleanup = () => db.user.deleteMany({ where: { id: { in: [...created] } } });

  beforeAll(() => {
    db = createPrismaClient(testDatabaseUrl!);
    registerOAuthSignInHooks(hooks);
  });
  beforeEach(() => {
    mergeGuest.mockClear();
    importAvatar.mockReset();
    importAvatar.mockImplementation(async () => {});
  });
  afterAll(async () => {
    await cleanup();
    await db.$disconnect();
  });

  it("first sign-in creates the account under the login, links GitHub and merges the guest", async () => {
    const providerId = Number.parseInt(randomBytes(3).toString("hex"), 16);
    const user = await signInWithGitHub({ id: providerId, login: `${PREFIX}cat` });

    const row = await db.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { oauthAccounts: true },
    });
    expect(row).toMatchObject({ isGuest: false, typistName: `${PREFIX}cat` });
    expect(row.oauthAccounts).toEqual([
      expect.objectContaining({ provider: "GITHUB", providerAccountId: String(providerId) }),
    ]);
    expect(mergeGuest).toHaveBeenCalledExactlyOnceWith(user.id);
  });

  it("a second sign-in reuses the account (no new row, same id) and merges again", async () => {
    const providerId = Number.parseInt(randomBytes(3).toString("hex"), 16);
    const first = await signInWithGitHub({ id: providerId, login: `${PREFIX}twice` });
    const second = await signInWithGitHub({ id: providerId, login: `${PREFIX}renamed` });
    expect(second.id).toBe(first.id);
    expect(await db.oAuthAccount.count({ where: { userId: first.id } })).toBe(1);
    expect(await db.user.count({ where: { typistName: { startsWith: `${PREFIX}renamed` } } })).toBe(
      0,
    );
    expect(mergeGuest).toHaveBeenNthCalledWith(2, first.id);
  });

  it("a login that fails isClean gets a generated typist name, never the login", async () => {
    const providerId = Number.parseInt(randomBytes(3).toString("hex"), 16);
    const user = await signInWithGitHub({ id: providerId, login: `${PREFIX}darn` });
    expect(user.name).toMatch(/^Typist-\d{3}$/);
    const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.typistName).toBe(user.name);
  });

  it("credentials sign-ins are not merged here (their action merges)", async () => {
    await createOAuthSignInEvent(() => hooks)({
      user: { id: "someone" },
      account: { provider: "credentials", type: "credentials", providerAccountId: "someone" },
    });
    expect(mergeGuest).not.toHaveBeenCalled();
  });

  describe("provider picture import (#539)", () => {
    const providerId = () => Number.parseInt(randomBytes(3).toString("hex"), 16);
    const githubUrl = (id: number) => `https://avatars.githubusercontent.com/u/${id}?v=4`;

    it("C1 a first sign-in hands the new user id and the mapped image URL to the import, once", async () => {
      const id = providerId();
      const url = githubUrl(id);
      // the fake import does what #52's does on success: the row gets an avatarKey
      importAvatar.mockImplementation(async (userId) => {
        await db.user.update({ where: { id: userId }, data: { avatarKey: `${userId}/first` } });
      });
      const { user, isNewUser } = await oauthSignIn("github", {
        id,
        login: `${PREFIX}pic`,
        avatar_url: url,
      });
      expect(isNewUser).toBe(true);
      await vi.waitFor(() => expect(importAvatar).toHaveBeenCalledExactlyOnceWith(user.id, url));
      await vi.waitFor(async () =>
        expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).avatarKey).toBe(
          `${user.id}/first`,
        ),
      );

      // second sign-in: same account, a new picture at the provider; nothing is imported or changed
      importAvatar.mockClear();
      const again = await oauthSignIn("github", {
        id,
        login: `${PREFIX}pic`,
        avatar_url: `${url}&changed=1`,
      });
      expect(again).toMatchObject({ isNewUser: false, user: { id: user.id } });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(importAvatar).not.toHaveBeenCalled();
      const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(row.avatarKey).toBe(`${user.id}/first`);
    });

    it("C1 a Discord sign-in hands over the CDN URL its profile() builds from the avatar hash", async () => {
      const id = String(providerId());
      const { user } = await oauthSignIn("discord", {
        id,
        username: `${PREFIX}disc`,
        avatar: "a1b2c3",
      });
      await vi.waitFor(() =>
        expect(importAvatar).toHaveBeenCalledExactlyOnceWith(
          user.id,
          `https://cdn.discordapp.com/avatars/${id}/a1b2c3.png`,
        ),
      );
    });

    it("C1 a profile without a picture imports nothing", async () => {
      await oauthSignIn("github", { id: providerId(), login: `${PREFIX}bare`, avatar_url: null });
      await oauthSignIn("discord", { id: String(providerId()), username: `${PREFIX}bd` });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(importAvatar).not.toHaveBeenCalled();
      expect(mergeGuest).toHaveBeenCalledTimes(2);
    });

    it("C2 the sign-in event succeeds when the import rejects (fetch failed)", async () => {
      const unhandled = vi.fn();
      process.on("unhandledRejection", unhandled);
      try {
        importAvatar.mockRejectedValue(new TypeError("fetch failed"));
        const id = providerId();
        await expect(
          oauthSignIn("github", { id, login: `${PREFIX}rej`, avatar_url: githubUrl(id) }),
        ).resolves.toMatchObject({ isNewUser: true });
        await vi.waitFor(() => expect(importAvatar).toHaveBeenCalledTimes(1));
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(unhandled).not.toHaveBeenCalled();
      } finally {
        process.off("unhandledRejection", unhandled);
      }
    });

    it("C2 the sign-in event succeeds when the import throws synchronously", async () => {
      importAvatar.mockImplementation(() => {
        throw new Error("boom");
      });
      const id = providerId();
      await expect(
        oauthSignIn("github", { id, login: `${PREFIX}sync`, avatar_url: githubUrl(id) }),
      ).resolves.toMatchObject({ isNewUser: true });
      expect(importAvatar).toHaveBeenCalledTimes(1);
    });

    it("C2 the sign-in event does not wait for the import (a hung CDN never blocks sign-in)", async () => {
      importAvatar.mockImplementation(() => new Promise<never>(() => {}));
      const id = providerId();
      await expect(
        oauthSignIn("github", { id, login: `${PREFIX}hang`, avatar_url: githubUrl(id) }),
      ).resolves.toMatchObject({ isNewUser: true });
      expect(importAvatar).toHaveBeenCalledTimes(1);
    });

    it("C3 the provider image URL is in no table row and no JWT claim", async () => {
      const id = providerId();
      const url = githubUrl(id);
      const { user, token } = await oauthSignIn("github", {
        id,
        login: `${PREFIX}leak`,
        avatar_url: url,
      });
      await vi.waitFor(() => expect(importAvatar).toHaveBeenCalledTimes(1));

      expect(token).toEqual({ sub: user.id, name: user.name, tokenVersion: 0 });
      expect(JSON.stringify(token)).not.toContain("githubusercontent");

      // every column of every row of every table that mentions this user, as text
      const tables = await db.$queryRaw<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;
      const hits: string[] = [];
      for (const { table_name } of tables) {
        const rows = await db.$queryRawUnsafe<{ t: string }[]>(
          `SELECT t::text AS t FROM "${table_name.replaceAll('"', '""')}" t`,
        );
        for (const { t } of rows) {
          if (t.includes(url) || t.includes("avatars.githubusercontent.com")) hits.push(table_name);
        }
      }
      expect(hits).toEqual([]);
    });
  });
});
