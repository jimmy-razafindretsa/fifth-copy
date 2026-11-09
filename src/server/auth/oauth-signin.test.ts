import "dotenv/config";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdapterUser } from "next-auth/adapters";
import { createPrismaClient } from "@/server/db-client";
import { createAuthAdapter } from "./adapter";
import { createOAuthSignInEvent, type OAuthSignInHooks } from "./oauth-signin";
import { githubProfile } from "./providers";
import { createTypistNameFor } from "./typist-name";

// #49 C3: the first OAuth sign-in creates the User (typistName = the provider login when it passes
// isClean, else a generated name), links the OAuthAccount and merges the current guest; a second
// sign-in reuses the account. Auth.js's own order is replayed (handle-login.js: getUserByAccount, then
// createUser + linkAccount, then events.signIn) over the real adapter and the test database.

// eslint-disable-next-line no-restricted-properties
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)("OAuth sign-in (needs TEST_DATABASE_URL)", () => {
  let db: ReturnType<typeof createPrismaClient>;
  const PREFIX = `oa${randomBytes(3).toString("hex")}`;
  const created = new Set<string>();
  const mergeGuest = vi.fn<OAuthSignInHooks["mergeGuest"]>(async () => {});
  const hooks: OAuthSignInHooks = {
    isCleanName: (name) => !/darn/i.test(name),
    mergeGuest,
  };

  /** One Auth.js OAuth callback for a GitHub profile; returns the signed-in user. */
  async function signInWithGitHub(fixture: { id: number; login: string }) {
    const adapter = createAuthAdapter({
      db,
      typistNameFor: createTypistNameFor(db, { isClean: hooks.isCleanName }),
    });
    const profile = githubProfile({ ...fixture, avatar_url: null });
    const account = {
      provider: "github",
      type: "oauth" as const,
      providerAccountId: profile.id,
      access_token: "dropped",
    };
    let user = await adapter.getUserByAccount!(account);
    if (!user) {
      user = await adapter.createUser!({
        ...profile,
        emailVerified: null,
      } as unknown as AdapterUser);
      created.add(user.id);
      await adapter.linkAccount!({ ...account, userId: user.id });
    }
    await createOAuthSignInEvent(() => hooks)({ user, account });
    return user;
  }

  const cleanup = () => db.user.deleteMany({ where: { id: { in: [...created] } } });

  beforeAll(() => {
    db = createPrismaClient(testDatabaseUrl!);
  });
  beforeEach(() => mergeGuest.mockClear());
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
});
