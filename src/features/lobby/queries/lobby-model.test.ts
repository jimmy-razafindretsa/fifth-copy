import "dotenv/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/server/db-client";
import { closeLobbies } from "./close-lobbies";
import { openLobbyWhere } from "./open-lobby-filter";

// ADR 0003: DB-backed tests target the test database, not the app env.
// eslint-disable-next-line no-restricted-properties
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)(
  "lobby model (needs TEST_DATABASE_URL, run scripts/test-db.sh)",
  () => {
    let db: ReturnType<typeof createPrismaClient>;
    const PREFIX = "test-lobby-";
    const CODE = "KGB-4821";
    const OTHER = "KGB-4822";

    // Deleting the host users cascades to their lobbies.
    const cleanup = async () => {
      await db.lobby.deleteMany({ where: { code: { in: [CODE, OTHER] } } });
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

    it("#734 C4: a CLOSED lobby leaves the open-rooms listing filter; a WAITING one stays", async () => {
      const { id: hostUserId } = await host("listing");
      const now = Date.now();
      const open = await db.lobby.create({ data: { code: CODE, hostUserId, type: "PUBLIC" } });
      const gone = await db.lobby.create({ data: { code: OTHER, hostUserId, type: "PUBLIC" } });
      expect(await closeLobbies(db, [gone.id], new Date(now))).toBe(1);
      const listed = await db.lobby.findMany({
        where: { ...openLobbyWhere(now), id: { in: [open.id, gone.id] } },
        select: { id: true },
      });
      expect(listed).toEqual([{ id: open.id }]);
    });

    it("#734: closeLobbies writes CLOSED once and never moves an earlier closedAt", async () => {
      const { id: hostUserId } = await host("close");
      const lobby = await db.lobby.create({ data: { code: CODE, hostUserId } });
      const first = new Date("2026-11-09T12:00:00Z");
      expect(await closeLobbies(db, [lobby.id], first)).toBe(1);
      expect(await closeLobbies(db, [lobby.id], new Date("2026-11-09T13:00:00Z"))).toBe(0);
      expect(await closeLobbies(db, [], first)).toBe(0);
      const read = await db.lobby.findUniqueOrThrow({ where: { id: lobby.id } });
      expect(read).toMatchObject({ status: "CLOSED", closedAt: first });
    });
  },
);
