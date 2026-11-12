import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "@/server/db-client";

// #880 C1 path (b) against real Postgres: the SQL behind `racedTogether` (24 h boundary, a race that
// never ended, two different races, bots). ADR 0003: DB-backed tests target the test database.
// eslint-disable-next-line no-restricted-properties
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

const holder = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/server/db", () => ({
  get db() {
    return holder.db;
  },
}));

describe.skipIf(!testDatabaseUrl)(
  "racedTogether (needs TEST_DATABASE_URL, run scripts/test-db.sh)",
  () => {
    const db = createPrismaClient(testDatabaseUrl ?? "postgresql://unused");
    holder.db = db;
    const PREFIX = "test-raced-together-";
    const NOW = Date.parse("2026-11-11T12:00:00Z");
    const HOUR = 3_600_000;
    const raceIds: string[] = [];

    const cleanup = async () => {
      await db.race.deleteMany({ where: { id: { in: raceIds.splice(0) } } });
      await db.user.deleteMany({ where: { typistName: { startsWith: PREFIX } } });
    };
    const user = async (name: string) =>
      (await db.user.create({ data: { isGuest: true, typistName: `${PREFIX}${name}` } })).id;

    /** A race that ended `hoursAgo` before NOW (null: never ended), one result per user (null: bot). */
    async function race(hoursAgo: number | null, userIds: (string | null)[]) {
      const id = randomUUID();
      raceIds.push(id);
      await db.race.create({
        data: {
          id,
          textContent: "le chat dort",
          textLanguage: "FR",
          textWordCount: 3,
          settings: { mode: "classic", durationS: 60 },
          startedAt: new Date(NOW - 25 * 7 * HOUR),
          endedAt: hoursAgo === null ? null : new Date(NOW - hoursAgo * HOUR),
          engineVersion: "0.1.0",
          protocolVersion: 2,
        },
      });
      for (const [desk, userId] of userIds.entries()) {
        await db.raceResult.create({
          data: {
            raceId: id,
            desk,
            userId,
            name: userId ? `${PREFIX}desk${desk}` : "Bot-1",
            isBot: userId === null,
            place: desk + 1,
            status: "FINISHED",
            wpm: 70,
            rawWpm: 70,
            cleanWpm: 70,
            adjustedWpm: 70,
            accuracy: 1,
            progress: 1,
            correct: 10,
            errors: 0,
            total: 10,
            durationMs: 30_000,
            finishedAtMs: 30_000,
            bonusesSent: 0,
            bonusesReceived: 0,
            bonusLog: [],
            engineVersion: "0.1.0",
          },
        });
      }
    }

    beforeEach(cleanup);
    afterAll(async () => {
      await cleanup();
      await db.$disconnect();
    });

    const together = async (a: string, b: string, now = NOW) => {
      const { racedTogether } = await import("./raced-together");
      return racedTogether(a, b, now);
    };

    it("is true for one race that ended 1 h ago, both ways; false for a third user", async () => {
      const [a, b, c] = [await user("a"), await user("b"), await user("c")];
      await race(1, [a, b, null]);
      expect(await together(a, b)).toBe(true);
      expect(await together(b, a)).toBe(true);
      expect(await together(c, a)).toBe(false);
    });

    it("counts less than 24 h only: 24 h less 1 ms true, exactly 24 h false", async () => {
      const [a, b] = [await user("a"), await user("b")];
      await race(24, [a, b]);
      expect(await together(a, b)).toBe(false);
      expect(await together(a, b, NOW - 1)).toBe(true);
    });

    it("is false for a race that never ended and for two different races", async () => {
      const [a, b] = [await user("a"), await user("b")];
      await race(null, [a, b]);
      await race(1, [a, null]);
      await race(1, [b, null]);
      expect(await together(a, b)).toBe(false);
    });
  },
);
