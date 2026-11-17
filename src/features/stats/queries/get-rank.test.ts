import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "@/server/db-client";
import { rankFor } from "../view/rank";
import { countedWhere } from "./counted-where";
import { getRank } from "./get-rank";

// The results index pulls in auth, which validates env at import (as get-profile.test.ts).
vi.mock("@/env", () => ({ env: { NODE_ENV: "test" } }));

// #969 C1: getRank is one aggregate of the viewer's counted results (mean clean WPM), then rankFor.

describe("getRank (stand-in client)", () => {
  it("one aggregate keyed by the viewer with the shared counted filter, the mean clean WPM only", async () => {
    const aggregate = vi.fn(async () => ({ _avg: { cleanWpm: 51.4 } }));
    const step = await getRank({ id: "me" }, { db: { raceResult: { aggregate } } as never });
    expect(aggregate).toHaveBeenCalledTimes(1);
    expect(aggregate).toHaveBeenCalledWith({
      where: countedWhere("me"),
      _avg: { cleanWpm: true },
    });
    expect(step).toEqual(rankFor(51.4));
    expect(step.rank).toBe("officer");
  });

  it("no counted race (a null mean) gives Recruit", async () => {
    const aggregate = vi.fn(async () => ({ _avg: { cleanWpm: null } }));
    const step = await getRank({ id: "me" }, { db: { raceResult: { aggregate } } as never });
    expect(step.rank).toBe("recruit");
  });
});

// eslint-disable-next-line no-restricted-properties
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)(
  "getRank (needs TEST_DATABASE_URL, run scripts/test-db.sh)",
  () => {
    const base = createPrismaClient(testDatabaseUrl ?? "postgresql://unused");
    const PREFIX = "test-get-rank-";
    const raceIds: string[] = [];
    const queries: string[] = [];
    // counts the SQL statements one getRank sends
    const db = base.$extends({
      query: {
        $allOperations: async ({ operation, model, args, query }) => {
          queries.push(`${model ?? ""}.${operation}`);
          return query(args);
        },
      },
    }) as unknown as NonNullable<Parameters<typeof getRank>[1]>["db"];

    const cleanup = async () => {
      await base.race.deleteMany({ where: { id: { in: raceIds.splice(0) } } });
      await base.user.deleteMany({ where: { typistName: { startsWith: PREFIX } } });
    };
    const user = async (name: string) =>
      (await base.user.create({ data: { isGuest: false, typistName: `${PREFIX}${name}` } })).id;

    type Desk = { userId: string | null; cleanWpm: number; isBot?: boolean; suspicious?: boolean };
    async function race(desks: Desk[], endReason: "ALL_FINISHED" | "VOID" = "ALL_FINISHED") {
      const id = randomUUID();
      raceIds.push(id);
      const at = new Date();
      await base.race.create({
        data: {
          id,
          textContent: "the cat sleeps",
          textLanguage: "EN",
          textWordCount: 3,
          settings: { mode: "classic", durationS: 60 },
          startedAt: at,
          endedAt: at,
          endReason,
          engineVersion: "0.1.0",
          protocolVersion: 2,
        },
      });
      await base.raceResult.createMany({
        data: desks.map((d, desk) => ({
          raceId: id,
          desk,
          userId: d.userId,
          name: `${PREFIX}desk${desk}`,
          isBot: d.isBot ?? d.userId === null,
          place: desk + 1,
          status: "FINISHED" as const,
          wpm: d.cleanWpm,
          rawWpm: d.cleanWpm,
          cleanWpm: d.cleanWpm,
          adjustedWpm: d.cleanWpm,
          accuracy: 0.97,
          progress: 1,
          correct: 10,
          errors: 0,
          total: 10,
          durationMs: 30_000,
          bonusesSent: 0,
          bonusesReceived: 0,
          bonusLog: [],
          suspicious: d.suspicious ?? false,
          engineVersion: "0.1.0",
          createdAt: at,
        })),
      });
    }

    beforeEach(async () => {
      await cleanup();
      queries.length = 0;
    });
    afterAll(async () => {
      await cleanup();
      await base.$disconnect();
    });

    it("three counted races averaging 51.4 hold Officer, in one query; another user's races never count", async () => {
      const me = await user("me");
      const other = await user("other");
      await race([
        { userId: me, cleanWpm: 40.2 },
        { userId: other, cleanWpm: 95 },
        { userId: null, cleanWpm: 99 },
      ]);
      await race([{ userId: me, cleanWpm: 61.4 }]);
      await race([{ userId: me, cleanWpm: 52.6 }]);
      // never counted: a bot row, a suspicious row, a voided race
      await race([{ userId: me, cleanWpm: 120, isBot: true }]);
      await race([{ userId: me, cleanWpm: 120, suspicious: true }]);
      await race([{ userId: me, cleanWpm: 120 }], "VOID");
      queries.length = 0;

      const step = await getRank({ id: me }, { db });
      expect(step.rank).toBe("officer");
      expect(step.nextRank).toBe("commissar");
      expect(queries).toEqual(["RaceResult.aggregate"]);

      expect((await getRank({ id: other }, { db })).rank).toBe("major");
    });

    it("no race gives Recruit", async () => {
      const me = await user("none");
      expect((await getRank({ id: me }, { db })).rank).toBe("recruit");
    });
  },
);
