import "dotenv/config";
import { randomUUID } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/server/db-client";

// ADR 0003: DB-backed tests target the test database, not the app env.
// eslint-disable-next-line no-restricted-properties
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)(
  "race model (needs TEST_DATABASE_URL, run scripts/test-db.sh)",
  () => {
    let db: ReturnType<typeof createPrismaClient>;
    const PREFIX = "test-race-";
    const CODE = "RCE-1880";

    // Deleting the prefixed users cascades to their lobbies, races, results and keystrokes.
    const cleanup = async () => {
      await db.lobby.deleteMany({ where: { code: CODE } });
      await db.user.deleteMany({ where: { typistName: { startsWith: PREFIX } } });
    };

    const user = (name: string) =>
      db.user.create({ data: { isGuest: true, typistName: `${PREFIX}${name}` } });

    /** A lobby hosted by `host` and one race in it. */
    const race = async (hostUserId: string) => {
      const lobby = await db.lobby.create({ data: { code: CODE, hostUserId } });
      return db.race.create({
        data: {
          id: randomUUID(),
          lobbyId: lobby.id,
          textContent: "le chat dort",
          textLanguage: "FR",
          textWordCount: 3,
          settings: { mode: "classic", durationS: 60 },
          startedAt: new Date(),
          engineVersion: "0.1.0",
          protocolVersion: 2,
        },
      });
    };

    const result = (
      raceId: string,
      desk: number,
      over: { userId?: string | null; isBot?: boolean; accuracy?: number; progress?: number } = {},
    ) =>
      db.raceResult.create({
        data: {
          raceId,
          desk,
          userId: over.userId ?? null,
          name: over.isBot ? "Bot-1" : `${PREFIX}desk${desk}`,
          isBot: over.isBot ?? false,
          place: desk + 1,
          status: "FINISHED",
          wpm: 72.5,
          rawWpm: 80,
          cleanWpm: 70,
          adjustedWpm: 74,
          accuracy: over.accuracy ?? 0.97,
          progress: over.progress ?? 1,
          correct: 120,
          errors: 4,
          total: 124,
          durationMs: 30_000,
          finishedAtMs: 30_000,
          bonusesSent: 1,
          bonusesReceived: 0,
          bonusLog: [{ t: 12_000, kind: "freeze", to: 1 }],
          engineVersion: "0.1.0",
        },
      });

    const keystrokes = (raceId: string, desk: number, userId: string) => {
      const strokes = [
        { t: 0, key: "l" },
        { t: 110, key: "e" },
      ];
      return db.raceKeystrokes.create({
        data: { raceId, desk, userId, data: gzipSync(JSON.stringify(strokes)), count: strokes.length },
      });
    };

    beforeAll(() => {
      db = createPrismaClient(testDatabaseUrl!);
    });
    beforeEach(cleanup);
    afterAll(async () => {
      await cleanup();
      await db.$disconnect();
    });

    it("inserts a race with a user result, a bot result and a keystroke blob", async () => {
      const typist = await user("insert");
      const r = await race(typist.id);
      await result(r.id, 0, { userId: typist.id });
      const bot = await result(r.id, 1, { isBot: true });
      await keystrokes(r.id, 0, typist.id);

      expect(bot.userId).toBeNull();
      expect(await db.raceResult.count({ where: { raceId: r.id } })).toBe(2);
      const blob = await db.raceKeystrokes.findUniqueOrThrow({
        where: { raceId_desk: { raceId: r.id, desk: 0 } },
      });
      expect(blob.count).toBe(2);
      expect(JSON.parse(gunzipSync(blob.data).toString("utf8"))).toEqual([
        { t: 0, key: "l" },
        { t: 110, key: "e" },
      ]);
      expect(blob.createdAt).toBeInstanceOf(Date);
    });

    it("rejects a second result for the same (raceId, desk)", async () => {
      const typist = await user("dup");
      const r = await race(typist.id);
      await result(r.id, 0, { userId: typist.id });
      await expect(result(r.id, 0, { isBot: true })).rejects.toMatchObject({ code: "P2002" });
    });

    it("accepts accuracy and progress of 0, 0.5 and 1 and defaults suspicious to false", async () => {
      const typist = await user("range");
      const r = await race(typist.id);
      for (const [desk, v] of [0, 0.5, 1].entries()) {
        const row = await result(r.id, desk, { isBot: true, accuracy: v, progress: v });
        expect(row.accuracy).toBe(v);
        expect(row.progress).toBe(v);
        expect(row.suspicious).toBe(false);
        expect(row.suspiciousReason).toBeNull();
      }
    });

    it("deletes a user's results and keystrokes but keeps the race", async () => {
      const host = await user("host");
      const typist = await user("leaver");
      const r = await race(host.id);
      await result(r.id, 0, { userId: typist.id });
      await result(r.id, 1, { isBot: true });
      await keystrokes(r.id, 0, typist.id);

      await db.user.delete({ where: { id: typist.id } });

      expect(await db.race.findUnique({ where: { id: r.id } })).not.toBeNull();
      expect(await db.raceResult.count({ where: { userId: typist.id } })).toBe(0);
      expect(await db.raceKeystrokes.count({ where: { userId: typist.id } })).toBe(0);
      expect(await db.raceResult.count({ where: { raceId: r.id } })).toBe(1);
    });

    it("deletes results and keystrokes with their race", async () => {
      const typist = await user("race-del");
      const r = await race(typist.id);
      await result(r.id, 0, { userId: typist.id });
      await keystrokes(r.id, 0, typist.id);

      await db.race.delete({ where: { id: r.id } });

      expect(await db.raceResult.count({ where: { raceId: r.id } })).toBe(0);
      expect(await db.raceKeystrokes.count({ where: { raceId: r.id } })).toBe(0);
    });

    it("deletes the race with its lobby", async () => {
      const typist = await user("lobby-del");
      const r = await race(typist.id);
      await result(r.id, 0, { userId: typist.id });

      await db.lobby.delete({ where: { id: r.lobbyId } });

      expect(await db.race.findUnique({ where: { id: r.id } })).toBeNull();
      expect(await db.raceResult.count({ where: { raceId: r.id } })).toBe(0);
    });
  },
);
