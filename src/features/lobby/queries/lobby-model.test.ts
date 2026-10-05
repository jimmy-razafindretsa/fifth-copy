import "dotenv/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/server/db-client";

// ADR 0003: DB-backed tests target the test database, not the app env.
// eslint-disable-next-line no-restricted-properties
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)(
  "lobby model (needs TEST_DATABASE_URL, run scripts/test-db.sh)",
  () => {
    let db: ReturnType<typeof createPrismaClient>;
    const PREFIX = "test-lobby-";
    const CODE = "KGB-4821";

    // Deleting the host users cascades to their lobbies.
    const cleanup = async () => {
      await db.lobby.deleteMany({ where: { code: CODE } });
      await db.user.deleteMany({ where: { typistName: { startsWith: PREFIX } } });
    };
    const host = (name: string) =>
      db.user.create({ data: { isGuest: true, typistName: `${PREFIX}${name}` } });

    beforeAll(() => {
      db = createPrismaClient(testDatabaseUrl!);
    });
    beforeEach(cleanup);
    afterAll(async () => {
      await cleanup();
      await db.$disconnect();
    });

    it("inserts a lobby with only code and hostUserId and defaults the rest", async () => {
      const { id: hostUserId } = await host("minimal");
      const lobby = await db.lobby.create({ data: { code: CODE, hostUserId } });
      const read = await db.lobby.findUniqueOrThrow({ where: { id: lobby.id } });
      expect(read.type).toBe("PRIVATE");
      expect(read.status).toBe("WAITING");
      expect(read.closedAt).toBeNull();
      expect(read.createdAt).toBeInstanceOf(Date);
    });

    it("rejects a duplicate code", async () => {
      const { id: hostUserId } = await host("dup");
      await db.lobby.create({ data: { code: CODE, hostUserId } });
      await expect(db.lobby.create({ data: { code: CODE, hostUserId } })).rejects.toMatchObject({
        code: "P2002",
      });
    });

    it("deletes the host's lobbies when the host user is deleted", async () => {
      const { id: hostUserId } = await host("cascade");
      const lobby = await db.lobby.create({ data: { code: CODE, hostUserId } });
      await db.user.delete({ where: { id: hostUserId } });
      expect(await db.lobby.findUnique({ where: { id: lobby.id } })).toBeNull();
    });
  },
);
