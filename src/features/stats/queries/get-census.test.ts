import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "@/server/db-client";
import { CENSUS_MIN_POPULATION, censusOf } from "../view/census";
import { countedPopulationWhere, countedWhere } from "./counted-where";
import * as module from "./get-census";
import { CENSUS_MEMO_MS, createCensusReader } from "./get-census";

// The results index pulls in auth, which validates env at import (as get-profile.test.ts).
vi.mock("@/env", () => ({ env: { NODE_ENV: "test" } }));

// #966 C5: getCensus reads the population with one grouped aggregate, memoised for 10 minutes on an
// injected clock, and the viewer's own figures fresh; only a Census or null comes out. The stand-in
// client offers only `groupBy` and `aggregate`: the read path cannot write.

type Group = {
  userId: string | null;
  _avg: { cleanWpm: number | null; accuracy: number | null };
  _max: { cleanWpm: number | null; accuracy: number | null };
};

const group = (i: number): Group => ({
  userId: `u${i}`,
  _avg: { cleanWpm: 30 + i, accuracy: 0.9 },
  _max: { cleanWpm: 40 + i, accuracy: 0.95 },
});

function standIn(groups: Group[], own = { races: 5, avg: 50, max: 60, acc: 0.93, best: 0.97 }) {
  const groupBy = vi.fn(async () => groups);
  const aggregate = vi.fn(async () => ({
    _count: { _all: own.races },
    _avg: { cleanWpm: own.avg, accuracy: own.acc },
    _max: { cleanWpm: own.max, accuracy: own.best },
  }));
  return { db: { raceResult: { groupBy, aggregate } } as never, groupBy, aggregate };
}

describe("getCensus (stand-in client)", () => {
  it("one grouped aggregate over the counted rule without the user, 3-race floor", async () => {
    const { db, groupBy } = standIn(Array.from({ length: 30 }, (_, i) => group(i)));
    await createCensusReader({ db, clock: () => 0 })(null);
    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(groupBy).toHaveBeenCalledWith({
      by: ["userId"],
      where: { ...countedPopulationWhere(), userId: { not: null } },
      having: { userId: { _count: { gte: 3 } } },
      _avg: { cleanWpm: true, accuracy: true },
      _max: { cleanWpm: true, accuracy: true },
    });
  });

  it("nothing but the reader and its memo length leaves the module (no population read export)", () => {
    expect(Object.keys(module).sort()).toEqual([
      "CENSUS_MEMO_MS",
      "createCensusReader",
      "getCensus",
    ]);
  });

  it("each typist's figures feed censusOf: same shapes as the pure function on the same four numbers", async () => {
    const groups = Array.from({ length: 30 }, (_, i) => group(i));
    const { db } = standIn(groups);
    const census = await createCensusReader({ db, clock: () => 0 })(null);
    const typists = groups.map((g) => ({
      averageWpm: g._avg.cleanWpm!,
      bestWpm: g._max.cleanWpm!,
      averageAccuracy: g._avg.accuracy!,
      bestAccuracy: g._max.accuracy!,
    }));
    expect(census).toEqual(censusOf(typists, null));
  });

  it("two calls within 10 minutes issue one population query; the viewer is read fresh each time", async () => {
    let now = 1_000_000;
    const { db, groupBy, aggregate } = standIn(Array.from({ length: 30 }, (_, i) => group(i)));
    const getCensus = createCensusReader({ db, clock: () => now });
    const first = await getCensus({ id: "me" });
    now += CENSUS_MEMO_MS - 1;
    await getCensus({ id: "me" });
    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(aggregate).toHaveBeenCalledTimes(2);
    expect(aggregate).toHaveBeenCalledWith({
      where: countedWhere("me"),
      _count: { _all: true },
      _avg: { cleanWpm: true, accuracy: true },
      _max: { cleanWpm: true, accuracy: true },
    });
    expect(first?.averageSpeed.value).toBe(50);
    expect(first?.averageAccuracy.value).toBe(93);
    now += 1;
    await getCensus({ id: "me" });
    expect(groupBy).toHaveBeenCalledTimes(2);
    expect(CENSUS_MEMO_MS).toBe(600_000);
  });

  it("#997: a zero memo (the Playwright server only) reads the population on every call", async () => {
    const groups = Array.from({ length: 29 }, (_, i) => group(i));
    const { db, groupBy } = standIn(groups);
    const getCensus = createCensusReader({ db, clock: () => 0, memoMs: 0 });
    expect(await getCensus({ id: "me" })).toBeNull();
    groups.push(group(29));
    expect(await getCensus({ id: "me" })).not.toBeNull();
    expect(groupBy).toHaveBeenCalledTimes(2);
  });

  it("under the floor: null, and the viewer is not read", async () => {
    const { db, aggregate } = standIn(Array.from({ length: 29 }, (_, i) => group(i)));
    const getCensus = createCensusReader({ db, clock: () => 0 });
    expect(await getCensus({ id: "me" })).toBeNull();
    expect(aggregate).not.toHaveBeenCalled();
  });

  it("no viewer: the population shapes without a place, no viewer read", async () => {
    const { db, aggregate } = standIn(Array.from({ length: 30 }, (_, i) => group(i)));
    const census = await createCensusReader({ db, clock: () => 0 })(null);
    expect(census?.averageSpeed.percentile).toBeNull();
    expect(aggregate).not.toHaveBeenCalled();
  });

  it("a viewer under 3 counted races has no place", async () => {
    const { db } = standIn(
      Array.from({ length: 30 }, (_, i) => group(i)),
      { races: 2, avg: 50, max: 60, acc: 0.9, best: 0.9 },
    );
    const census = await createCensusReader({ db, clock: () => 0 })({ id: "me" });
    expect(census?.bestSpeed.value).toBeNull();
  });

  it("a failed population read is not memoised", async () => {
    const { db, groupBy } = standIn(Array.from({ length: 30 }, (_, i) => group(i)));
    groupBy.mockRejectedValueOnce(new Error("down"));
    const getCensus = createCensusReader({ db, clock: () => 0 });
    await expect(getCensus(null)).rejects.toThrow("down");
    expect(await getCensus(null)).not.toBeNull();
    expect(groupBy).toHaveBeenCalledTimes(2);
  });
});

// eslint-disable-next-line no-restricted-properties
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)(
  "getCensus (needs TEST_DATABASE_URL, run scripts/test-db.sh)",
  () => {
    const base = createPrismaClient(testDatabaseUrl ?? "postgresql://unused");
    const db = base as never;
    const PREFIX = "test-get-census-";
    const raceIds: string[] = [];
    const AT = new Date("2026-11-16T17:00:00Z");

    const cleanup = async () => {
      await base.race.deleteMany({ where: { id: { in: raceIds.splice(0) } } });
      await base.user.deleteMany({ where: { typistName: { startsWith: PREFIX } } });
    };
    const user = async (name: string) =>
      (await base.user.create({ data: { isGuest: true, typistName: `${PREFIX}${name}` } })).id;

    type Desk = { userId: string; wpm: number; isBot?: boolean; suspicious?: boolean };
    async function race(desks: Desk[], endReason: "ALL_FINISHED" | "VOID" = "ALL_FINISHED") {
      const id = randomUUID();
      raceIds.push(id);
      await base.race.create({
        data: {
          id,
          textContent: "le chat dort",
          textLanguage: "FR",
          textWordCount: 3,
          settings: { mode: "classic", durationS: 60 },
          startedAt: AT,
          endedAt: AT,
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
          isBot: d.isBot ?? false,
          place: desk + 1,
          status: "FINISHED" as const,
          wpm: d.wpm,
          rawWpm: d.wpm,
          cleanWpm: d.wpm,
          adjustedWpm: d.wpm,
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
          createdAt: AT,
        })),
      });
    }

    beforeEach(cleanup);
    afterAll(async () => {
      await cleanup();
      await base.$disconnect();
    });

    it("30 seeded typists count; a flagged typist, a bot and voided races do not", async () => {
      // Distinctive speeds so the seeded typists can be told apart from rows of parallel test files.
      const speed = (i: number) => 101.001 + i / 1000;
      const typists = await Promise.all(Array.from({ length: 30 }, (_, i) => user(`t${i}`)));
      for (let r = 0; r < 3; r++) {
        await race(typists.map((userId, i) => ({ userId, wpm: speed(i) })));
      }
      const flagged = await user("flagged");
      const botted = await user("bot");
      const voided = await user("voided");
      const short = await user("short");
      for (let r = 0; r < 3; r++) {
        await race([
          { userId: flagged, wpm: 7.007, suspicious: true },
          { userId: botted, wpm: 8.008, isBot: true },
        ]);
        await race([{ userId: voided, wpm: 9.009 }], "VOID");
      }
      await race([{ userId: short, wpm: 6.006 }]);
      await race([{ userId: short, wpm: 6.006 }]);

      // Spy on the one grouped read through the reader (the population read itself is private).
      let groups: { _avg: { cleanWpm: number | null } }[] = [];
      const spy = {
        raceResult: {
          groupBy: async (args: never) => (groups = await base.raceResult.groupBy(args)),
          aggregate: (args: never) => base.raceResult.aggregate(args),
        },
      } as never;
      await createCensusReader({ db: spy, clock: () => 0 })(null);
      const population = groups.map((g) => ({ averageWpm: g._avg.cleanWpm ?? 0 }));
      const speeds = population.map((t) => t.averageWpm);
      for (let i = 0; i < 30; i++) expect(speeds).toContainEqual(expect.closeTo(speed(i), 6));
      for (const excluded of [7.007, 8.008, 9.009, 6.006]) {
        expect(speeds.some((s) => Math.abs(s - excluded) < 1e-6)).toBe(false);
      }
      expect(population.length).toBeGreaterThanOrEqual(CENSUS_MIN_POPULATION);

      const census = await createCensusReader({ db, clock: () => 0 })({ id: typists[29]! });
      expect(census).not.toBeNull();
      expect(census?.averageSpeed.value).toBeCloseTo(speed(29), 1);
      expect(census?.averageAccuracy.value).toBe(97);
      expect(census?.averageSpeed.percentile).toBeGreaterThan(0);
      const newcomer = await createCensusReader({ db, clock: () => 0 })({ id: short });
      expect(newcomer?.averageSpeed.percentile).toBeNull();
    });
  },
);
