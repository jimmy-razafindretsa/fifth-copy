import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "@/server/db-client";
import { CENSUS_MIN_POPULATION } from "../view/census";
import { createCensusReader } from "./get-census";
import { getKeyFile } from "./get-key-file";
import { getProfile } from "./get-profile";

// The results index pulls in auth, which validates env at import; CI has no AUTH_SECRET (like route.test.ts).
vi.mock("@/env", () => ({ env: { NODE_ENV: "test" } }));

// #970 C5: the weight of /profile. The page's stats reads (the profile of #931, the key file of #961,
// the census of #966) issue the same number of queries for a 20-race file as for a 300-race one, so
// rendering the Personnel file does not grow with the number of races. DB-backed (ADR 0003); every row
// carries this file's prefix, since other test files share the database.

// eslint-disable-next-line no-restricted-properties
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-17T17:00:00Z");
const DAY = 86_400_000;

describe.skipIf(!testDatabaseUrl)(
  "/profile reads in a constant number of queries (needs TEST_DATABASE_URL)",
  () => {
    const base = createPrismaClient(testDatabaseUrl ?? "postgresql://unused");
    let queries = 0;
    const counted = base.$extends({
      query: {
        async $allOperations({ args, query }) {
          queries += 1;
          return query(args);
        },
      },
    });
    const db = counted as never;
    const PREFIX = "test-profile-weight-";
    const raceIds: string[] = [];

    const cleanup = async () => {
      await base.race.deleteMany({ where: { id: { in: raceIds.splice(0) } } });
      await base.user.deleteMany({ where: { typistName: { startsWith: PREFIX } } });
    };
    const user = async (name: string) =>
      (await base.user.create({ data: { isGuest: true, typistName: `${PREFIX}${name}` } })).id;

    /** `n` counted races for each of `users`, one a day back from NOW (wrapping every 60 days). */
    async function races(users: string[], n: number) {
      const rows = Array.from({ length: n }, (_, i) => ({
        id: randomUUID(),
        at: new Date(NOW.getTime() - (i % 60) * DAY - i * 60_000),
      }));
      raceIds.push(...rows.map((r) => r.id));
      await base.race.createMany({
        data: rows.map(({ id, at }) => ({
          id,
          textContent: "le chat dort",
          textLanguage: "FR" as const,
          textWordCount: 3,
          settings: { mode: "classic", durationS: 60 },
          startedAt: at,
          endedAt: at,
          endReason: "ALL_FINISHED" as const,
          engineVersion: "0.1.0",
          protocolVersion: 2,
        })),
      });
      await base.raceResult.createMany({
        data: rows.flatMap(({ id, at }, i) =>
          users.map((userId, desk) => ({
            raceId: id,
            desk,
            userId,
            name: `${PREFIX}desk${desk}`,
            isBot: false,
            place: desk + 1,
            status: "FINISHED" as const,
            wpm: 40 + (i % 20),
            rawWpm: 40 + (i % 20),
            cleanWpm: 40 + (i % 20),
            adjustedWpm: 40 + (i % 20),
            accuracy: 0.95,
            progress: 1,
            correct: 10,
            errors: 0,
            total: 10,
            durationMs: 30_000,
            bonusesSent: 0,
            bonusesReceived: 0,
            bonusLog: [],
            suspicious: false,
            engineVersion: "0.1.0",
            createdAt: at,
          })),
        ),
      });
    }

    /** Key rows (#314's CharStatDaily and BigramStatDaily) on `days` days for `userId`. */
    async function keys(userId: string, days: number) {
      const day = (i: number) => new Date(Date.UTC(2026, 10, 17) - i * DAY);
      const counts = { hits: 24, errors: 2, timedHits: 20, totalMs: 4_000 };
      await base.charStatDaily.createMany({
        data: Array.from({ length: days }, (_, i) =>
          ["e", "a", "s"].map((char) => ({
            userId,
            day: day(i),
            char,
            layout: "CSA" as const,
            ...counts,
          })),
        ).flat(),
      });
      await base.bigramStatDaily.createMany({
        data: Array.from({ length: days }, (_, i) => ({
          userId,
          day: day(i),
          pair: "es",
          ...counts,
        })),
      });
    }

    /** The queries the page's three stats reads issue for `userId`, a fresh census memo each time. */
    async function weigh(userId: string): Promise<number> {
      const viewer = { id: userId };
      const census = createCensusReader({ db, clock: () => NOW.getTime() });
      queries = 0;
      const [profile, keyFile, place] = await Promise.all([
        getProfile(viewer, { db, now: NOW }),
        getKeyFile(viewer, { db }),
        census(viewer),
      ]);
      const issued = queries;
      expect(profile.service.races).toBeGreaterThanOrEqual(20);
      expect(keyFile.days.length).toBeGreaterThan(0);
      expect(place).not.toBeNull();
      return issued;
    }

    let small: string;
    let large: string;

    beforeAll(async () => {
      await cleanup();
      small = await user("small");
      large = await user("large");
      // the census needs its floor of typists with 3 counted races, so its viewer read runs too
      const crowd = await Promise.all(
        Array.from({ length: CENSUS_MIN_POPULATION }, (_, i) => user(`crowd-${i}`)),
      );
      await races(crowd, 3);
      await races([small], 20);
      await races([large], 300);
      await keys(small, 2);
      await keys(large, 60);
    }, 60_000);

    afterAll(async () => {
      await cleanup();
      await base.$disconnect();
    });

    it("C5 a 20-race file and a 300-race file cost the same number of queries", async () => {
      const forSmall = await weigh(small);
      const forLarge = await weigh(large);
      expect(forLarge).toBe(forSmall);
      // #931's profile reads (9), #961's key file (at most 3), #966's census (population + viewer)
      expect(forSmall).toBeLessThanOrEqual(14);
      const profile = await getProfile({ id: large }, { db: base as never, now: NOW });
      expect(profile.service.races).toBe(300);
    }, 60_000);
  },
);
