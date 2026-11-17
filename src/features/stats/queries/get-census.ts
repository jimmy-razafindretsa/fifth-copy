import "server-only";
import { env } from "@/env";
import type { db as appDb } from "@/server/db";
import {
  CENSUS_MIN_POPULATION,
  CENSUS_MIN_RACES,
  type Census,
  type CensusTypist,
  censusOf,
} from "../view/census";
import { countedPopulationWhere, countedWhere } from "./counted-where";

/**
 * The typist census read (#966, ADR 0023). One grouped aggregate reduces every typist (a user, account
 * or guest, with at least `CENSUS_MIN_RACES` counted results) to four numbers; ids are dropped on the
 * spot. The population is kept in process for `CENSUS_MEMO_MS`; the viewer's own figures are read
 * fresh. Only `censusOf`'s result (a `Census` or `null`) leaves this module.
 *
 * Extension point: `readPopulation` is the one population read, so a snapshot table can replace it
 * behind the memo without touching the view.
 */

/** How long the population read is kept in process (the Playwright web server alone may shorten it, #997). */
export const CENSUS_MEMO_MS = 10 * 60_000;

type Db = { raceResult: Pick<typeof appDb.raceResult, "groupBy" | "aggregate"> };

/** Who is looking: only the id matters (ADR 0009); guests are typists too. */
type CensusViewerRef = { id: string } | null;

/** Every typist as four numbers (clean WPM, ADR 0016; accuracy as stored). No id leaves this function; private. */
async function readPopulation(db: Db): Promise<CensusTypist[]> {
  const groups = await db.raceResult.groupBy({
    by: ["userId"],
    where: { ...countedPopulationWhere(), userId: { not: null } },
    having: { userId: { _count: { gte: CENSUS_MIN_RACES } } },
    _avg: { cleanWpm: true, accuracy: true },
    _max: { cleanWpm: true, accuracy: true },
  });
  return groups.map((g) => ({
    averageWpm: g._avg.cleanWpm ?? 0,
    bestWpm: g._max.cleanWpm ?? 0,
    averageAccuracy: g._avg.accuracy ?? 0,
    bestAccuracy: g._max.accuracy ?? 0,
  }));
}

/**
 * A census reader with its own in-process memo. `db` defaults to the app client (imported lazily),
 * `clock` to `Date.now`, `memoMs` to `CENSUS_MEMO_MS`.
 */
export function createCensusReader({
  db,
  clock = Date.now,
  memoMs = CENSUS_MEMO_MS,
}: { db?: Db; clock?: () => number; memoMs?: number } = {}): (viewer: CensusViewerRef) => Promise<Census | null> {
  let memo: { at: number; population: Promise<CensusTypist[]> } | null = null;
  const client = async (): Promise<Db> => db ?? (await import("@/server/db")).db;

  const population = async (): Promise<CensusTypist[]> => {
    const now = clock();
    if (!memo || now - memo.at >= memoMs) {
      const read = client().then(readPopulation);
      memo = { at: now, population: read };
      read.catch(() => {
        if (memo?.population === read) memo = null;
      });
    }
    return memo.population;
  };

  return async (viewer) => {
    const typists = await population();
    if (typists.length < CENSUS_MIN_POPULATION) return null;
    if (!viewer) return censusOf(typists, null);
    const own = await (
      await client()
    ).raceResult.aggregate({
      where: countedWhere(viewer.id),
      _count: { _all: true },
      _avg: { cleanWpm: true, accuracy: true },
      _max: { cleanWpm: true, accuracy: true },
    });
    return censusOf(typists, {
      races: own._count._all,
      averageWpm: own._avg.cleanWpm ?? 0,
      bestWpm: own._max.cleanWpm ?? 0,
      averageAccuracy: own._avg.accuracy ?? 0,
      bestAccuracy: own._max.accuracy ?? 0,
    });
  };
}

/** The app's census reader: where `viewer` stands among all typists, or `null` under the floor. */
export const getCensus = createCensusReader({
  memoMs: env.E2E_CENSUS_MEMO_MS ?? CENSUS_MEMO_MS,
});
