import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_RACE_MS } from "@fifth-copy/protocol";
import { createPrismaClient } from "@/server/db-client";
import { COUNTED_RACE } from "../queries/counted-races";
import { VOID_AFTER_MS, voidStaleRaces } from "./void-stale-races";

// #613 C1: a race the race server voided (#204, nothing persisted, ADR 0008) leaves a `Race` row with
// `endedAt` null; the `race.void` job ends it with reason VOID once it is older than VOID_AFTER_MS.
// #613 C2: the counted-race filter every stats/results consumer uses never matches it.
// ADR 0003: DB-backed tests target the test database, not the app env.
// eslint-disable-next-line no-restricted-properties
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const silent = { info: () => undefined, error: () => undefined };

describe("VOID_AFTER_MS", () => {
  it("outlasts the longest race plus its countdown, so a live race is never swept", () => {
    expect(VOID_AFTER_MS).toBeGreaterThanOrEqual(MAX_RACE_MS + 30 * 60 * 1000);
  });
});

describe.skipIf(!testDatabaseUrl)(
  "race.void job (needs TEST_DATABASE_URL, run scripts/test-db.sh)",
  () => {
    let db: ReturnType<typeof createPrismaClient>;
    const PREFIX = "test-race-void-";
    const raceIds: string[] = [];
    const NOW = new Date("2026-11-09T12:00:00Z");
    const ago = (ms: number) => new Date(NOW.getTime() - ms);

    const cleanup = async () => {
      await db.race.deleteMany({ where: { id: { in: raceIds } } });
      await db.user.deleteMany({ where: { typistName: { startsWith: PREFIX } } });
    };

    const race = async (startedAt: Date, end?: { endedAt: Date; reason: "TIMER" }) => {
      const id = randomUUID();
      raceIds.push(id);
      await db.race.create({
        data: {
          id,
          textContent: "le chat dort",
          textLanguage: "FR",
          textWordCount: 3,
          settings: {},
          startedAt,
          endedAt: end?.endedAt ?? null,
          endReason: end?.reason ?? null,
          engineVersion: "0.1.0",
          protocolVersion: 1,
        },
      });
      return id;
    };

    const result = (raceId: string) =>
      db.raceResult.create({
        data: {
          raceId,
          desk: 1,
          name: "Bot-1",
          isBot: true,
          place: 1,
          status: "FINISHED",
          wpm: 50,
          rawWpm: 50,
          cleanWpm: 50,
          adjustedWpm: 50,
          accuracy: 1,
          progress: 1,
          correct: 10,
          errors: 0,
          total: 10,
          durationMs: 10_000,
          finishedAtMs: 10_000,
          bonusesSent: 0,
          bonusesReceived: 0,
          bonusLog: [],
          engineVersion: "0.1.0",
        },
      });

    const rowOf = (id: string) =>
      db.race.findUnique({
        where: { id },
        select: { endedAt: true, endReason: true, _count: { select: { results: true } } },
      });

    beforeAll(async () => {
      db = createPrismaClient(testDatabaseUrl!);
      await cleanup();
    });
    afterAll(async () => {
      await cleanup();
      await db.$disconnect();
    });

    it("C1: ends a stale open race with reason VOID and no results; leaves live and ended races; a rerun changes nothing", async () => {
      const voided = await race(ago(VOID_AFTER_MS + 60_000));
      const live = await race(ago(VOID_AFTER_MS - 60_000));
      const endedAt = ago(VOID_AFTER_MS);
      const ended = await race(ago(VOID_AFTER_MS + 120_000), { endedAt, reason: "TIMER" });
      await result(ended);

      await voidStaleRaces.run({ db, now: NOW, log: silent });

      expect(await rowOf(voided)).toEqual({
        endedAt: NOW,
        endReason: "VOID",
        _count: { results: 0 },
      });
      expect(await rowOf(live)).toEqual({ endedAt: null, endReason: null, _count: { results: 0 } });
      expect(await rowOf(ended)).toEqual({ endedAt, endReason: "TIMER", _count: { results: 1 } });

      const later = new Date(NOW.getTime() + 3_600_000);
      await voidStaleRaces.run({ db, now: later, log: silent });
      expect((await rowOf(voided))?.endedAt).toEqual(NOW);
    });

    it("C2: the counted-race filter matches only races that ended with results, never a voided or open one", async () => {
      const voided = await race(ago(VOID_AFTER_MS + 60_000));
      const open = await race(ago(60_000));
      const ended = await race(ago(VOID_AFTER_MS), { endedAt: ago(1_000), reason: "TIMER" });
      await result(ended);
      await voidStaleRaces.run({ db, now: NOW, log: silent });

      const counted = await db.race.findMany({
        where: { id: { in: [voided, open, ended] }, ...COUNTED_RACE },
        select: { id: true },
      });
      expect(counted).toEqual([{ id: ended }]);
      const countedResults = await db.raceResult.count({
        where: { raceId: { in: [voided, open, ended] }, race: COUNTED_RACE },
      });
      expect(countedResults).toBe(1);
    });
  },
);
