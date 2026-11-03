import "dotenv/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/server/db-client";
import {
  KeyboardLayout,
  Locale,
  OAuthProvider,
  Theme,
} from "@/generated/prisma/client";
import {
  seedIdentity,
  SEED_ACCOUNT_PROVIDER_ACCOUNT_ID,
  SEED_ACCOUNT_USERNAME,
  SEED_GUEST_TYPIST_NAME,
} from "../../../../prisma/seed-identity";
import { normalizeUsername } from "../schema";

// ADR 0003: DB-backed tests target the test database, not the app env.
// eslint-disable-next-line no-restricted-properties
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe("normalizeUsername", () => {
  it("folds case and surrounding whitespace", () => {
    expect(normalizeUsername("  Sparrow ")).toBe(normalizeUsername("sparrow"));
  });
});

describe("identity enums (#486)", () => {
  it("exports exactly the contract values", () => {
    expect(Object.values(OAuthProvider)).toEqual(["GITHUB", "DISCORD"]);
    expect(Object.values(KeyboardLayout)).toEqual(["CSA", "FR_CA", "US_QWERTY", "AZERTY"]);
    expect(Object.values(Theme)).toEqual(["LIGHT", "DARK", "SYSTEM"]);
    expect(Object.values(Locale)).toEqual(["FR", "EN"]);
  });
});

describe.skipIf(!testDatabaseUrl)(
  "identity model (needs TEST_DATABASE_URL, run scripts/test-db.sh)",
  () => {
    let db: ReturnType<typeof createPrismaClient>;
    const PREFIX = "test-identity-";

    const cleanup = () =>
      db.user.deleteMany({
        where: {
          OR: [
            { typistName: { startsWith: PREFIX } },
            { typistName: SEED_GUEST_TYPIST_NAME },
            { usernameNormalized: normalizeUsername(SEED_ACCOUNT_USERNAME) },
          ],
        },
      });

    beforeAll(() => {
      db = createPrismaClient(testDatabaseUrl!);
    });
    beforeEach(cleanup);
    afterAll(async () => {
      await cleanup();
      await db.$disconnect();
    });

    it("inserts a guest with only isGuest and typistName", async () => {
      const user = await db.user.create({ data: { isGuest: true, typistName: `${PREFIX}guest` } });
      expect(user.tokenVersion).toBe(0);
      expect(user.avatarStatus).toBe("NONE");
      expect(user.username).toBeNull();
      expect(user.passwordHash).toBeNull();
    });

    it("rejects a duplicate typistName", async () => {
      await db.user.create({ data: { isGuest: true, typistName: `${PREFIX}dup` } });
      await expect(
        db.user.create({ data: { isGuest: true, typistName: `${PREFIX}dup` } }),
      ).rejects.toMatchObject({ code: "P2002" });
    });

    it("rejects usernames that differ only by case", async () => {
      const account = (typistName: string, username: string) =>
        db.user.create({
          data: {
            isGuest: false,
            typistName,
            username,
            usernameNormalized: normalizeUsername(username),
          },
        });
      await account(`${PREFIX}a`, "Sparrow");
      await expect(account(`${PREFIX}b`, "sparrow")).rejects.toMatchObject({ code: "P2002" });
    });

    it("seedIdentity is idempotent and creates one guest", async () => {
      // Scoped to the row the seed owns: other DB test files insert users in
      // parallel against the same TEST_DATABASE_URL, so a global count races.
      const seeded = { typistName: SEED_GUEST_TYPIST_NAME };
      const first = await seedIdentity(db);
      await seedIdentity(db);
      expect(await db.user.count({ where: seeded })).toBe(1);
      const guest = await db.user.findUniqueOrThrow({ where: seeded });
      expect(guest.id).toBe(first.id);
      expect(guest.isGuest).toBe(true);
    });

    const newUser = (suffix: string) =>
      db.user.create({ data: { isGuest: false, typistName: `${PREFIX}${suffix}` } });
    // Provider ids scoped per test run so parallel DB test files never collide.
    const providerId = (suffix: string) => `${PREFIX}${suffix}-${process.pid}`;

    it("rejects a second OAuthAccount with the same provider and provider account id", async () => {
      const a = await newUser("oauth-a");
      const b = await newUser("oauth-b");
      const pid = providerId("dup");
      await db.oAuthAccount.create({
        data: { userId: a.id, provider: "GITHUB", providerAccountId: pid },
      });
      await expect(
        db.oAuthAccount.create({
          data: { userId: b.id, provider: "GITHUB", providerAccountId: pid },
        }),
      ).rejects.toMatchObject({ code: "P2002" });
    });

    it("lets one user hold one GITHUB and one DISCORD link", async () => {
      const user = await newUser("oauth-both");
      await db.oAuthAccount.create({
        data: { userId: user.id, provider: "GITHUB", providerAccountId: providerId("gh") },
      });
      await db.oAuthAccount.create({
        data: { userId: user.id, provider: "DISCORD", providerAccountId: providerId("dc") },
      });
      expect(await db.oAuthAccount.count({ where: { userId: user.id } })).toBe(2);
    });

    it("rejects a second RecoveryCode for the same user", async () => {
      const user = await newUser("recovery");
      await db.recoveryCode.create({ data: { userId: user.id, codeHash: "h1" } });
      await expect(
        db.recoveryCode.create({ data: { userId: user.id, codeHash: "h2" } }),
      ).rejects.toMatchObject({ code: "P2002" });
    });

    it("rejects a second Preference for the same user", async () => {
      const user = await newUser("pref-dup");
      await db.preference.create({ data: { userId: user.id } });
      await expect(db.preference.create({ data: { userId: user.id } })).rejects.toMatchObject({
        code: "P2002",
      });
    });

    it("reads Preference defaults from a bare row", async () => {
      const user = await newUser("pref-defaults");
      const pref = await db.preference.create({ data: { userId: user.id } });
      expect(pref).toMatchObject({ theme: "SYSTEM", sound: true, layout: null, locale: null });
    });

    it("deleting the User deletes its OAuthAccount, RecoveryCode and Preference", async () => {
      const user = await newUser("cascade");
      await db.oAuthAccount.create({
        data: { userId: user.id, provider: "DISCORD", providerAccountId: providerId("cascade") },
      });
      await db.recoveryCode.create({ data: { userId: user.id, codeHash: "h" } });
      await db.preference.create({ data: { userId: user.id } });
      await db.user.delete({ where: { id: user.id } });
      const where = { userId: user.id };
      expect(await db.oAuthAccount.count({ where })).toBe(0);
      expect(await db.recoveryCode.count({ where })).toBe(0);
      expect(await db.preference.count({ where })).toBe(0);
    });

    it("seedIdentity upserts one account user with a GITHUB link and a Preference, idempotently", async () => {
      const account = { usernameNormalized: normalizeUsername(SEED_ACCOUNT_USERNAME) };
      const link = {
        provider: "GITHUB" as const,
        providerAccountId: SEED_ACCOUNT_PROVIDER_ACCOUNT_ID,
      };
      const counts = async () => {
        const user = await db.user.findUniqueOrThrow({ where: account });
        return {
          users: await db.user.count({ where: account }),
          links: await db.oAuthAccount.count({ where: { userId: user.id } }),
          linkPair: await db.oAuthAccount.count({ where: link }),
          prefs: await db.preference.count({ where: { userId: user.id } }),
          guests: await db.user.count({ where: { typistName: SEED_GUEST_TYPIST_NAME } }),
        };
      };
      await seedIdentity(db);
      const first = await counts();
      await seedIdentity(db);
      expect(await counts()).toEqual(first);
      expect(first).toEqual({ users: 1, links: 1, linkPair: 1, prefs: 1, guests: 1 });
      const user = await db.user.findUniqueOrThrow({ where: account });
      expect(user).toMatchObject({
        isGuest: false,
        username: SEED_ACCOUNT_USERNAME,
        passwordHash: null,
      });
    });
  },
);
