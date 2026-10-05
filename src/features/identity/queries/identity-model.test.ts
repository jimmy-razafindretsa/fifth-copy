import "dotenv/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/server/db-client";
import { seedIdentity, SEED_GUEST_TYPIST_NAME } from "../../../../prisma/seed-identity";
import { normalizeUsername } from "../schema";

// ADR 0003: DB-backed tests target the test database, not the app env.
// eslint-disable-next-line no-restricted-properties
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe("normalizeUsername", () => {
  it("folds case and surrounding whitespace", () => {
    expect(normalizeUsername("  Sparrow ")).toBe(normalizeUsername("sparrow"));
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
          OR: [{ typistName: { startsWith: PREFIX } }, { typistName: SEED_GUEST_TYPIST_NAME }],
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
      await seedIdentity(db);
      const after1 = await db.user.count();
      await seedIdentity(db);
      expect(await db.user.count()).toBe(after1);
      const guest = await db.user.findUniqueOrThrow({
        where: { typistName: SEED_GUEST_TYPIST_NAME },
      });
      expect(guest.isGuest).toBe(true);
    });
  },
);
