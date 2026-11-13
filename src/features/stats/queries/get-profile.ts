import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { db as appDb } from "@/server/db";
import {
  buildProfile,
  EMPTY_SERVICE,
  GAIN_SAMPLE,
  LANGUAGES,
  type LanguageStats,
  type Language,
  type Profile,
  type ProfileService,
  type ResultRow,
  SERIES_LIMIT,
} from "../view/profile";
import { countedWhere } from "./counted-where";

/** Who is looking: only the id matters (ADR 0009); guests have a file too. */
type ProfileViewer = { id: string } | null;

type Db = { raceResult: Pick<typeof appDb.raceResult, "findMany" | "aggregate" | "groupBy"> };

/** Only what the view reads: `cleanWpm` (ADR 0016), never `wpm`, `rawWpm` or `adjustedWpm`. */
const ROW_SELECT = {
  createdAt: true,
  cleanWpm: true,
  accuracy: true,
  durationMs: true,
  place: true,
  race: { select: { textLanguage: true } },
} satisfies Prisma.RaceResultSelect;

type Selected = Prisma.RaceResultGetPayload<{ select: typeof ROW_SELECT }>;

const toRow = (r: Selected): ResultRow => ({
  createdAt: r.createdAt,
  cleanWpm: r.cleanWpm,
  accuracy: r.accuracy,
  language: r.race.textLanguage,
  durationMs: r.durationMs,
  place: r.place,
});

/** The podium places (1 to 3) the service record counts (#932: wins = place 1, podiums = 1 to 3). */
const PODIUM_PLACES = [1, 2, 3] as const;

/**
 * The viewer's Personnel file (#931, spec 13.2, ADR 0008, 0009, 0016): their own counted results only,
 * read from `RaceResult` (never `RaceKeystrokes`). A constant number of queries whatever the file's size:
 * the latest `SERIES_LIMIT` results, the earliest `GAIN_SAMPLE`, one aggregate per language for the
 * whole-file totals and bests, and for the service record (#932) one whole-file aggregate and one count
 * per podium place. A `null` viewer gets the empty profile without a query.
 */
export async function getProfile(
  viewer: ProfileViewer,
  { db, now = new Date() }: { db?: Db; now?: Date } = {},
): Promise<Profile> {
  if (!viewer) return buildProfile([], now);
  const client: Db = db ?? (await import("@/server/db")).db;
  const where = countedWhere(viewer.id);
  const [latest, earliest, whole, byPlace, ...perLanguage] = await Promise.all([
    client.raceResult.findMany({
      where,
      select: ROW_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: SERIES_LIMIT,
    }),
    client.raceResult.findMany({
      where,
      select: ROW_SELECT,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: GAIN_SAMPLE,
    }),
    client.raceResult.aggregate({
      where,
      _count: { _all: true },
      _sum: { durationMs: true },
      _max: { cleanWpm: true, accuracy: true },
      _avg: { cleanWpm: true, accuracy: true },
    }),
    client.raceResult.groupBy({
      by: ["place"],
      where: { ...where, place: { in: [...PODIUM_PLACES] } },
      _count: { _all: true },
      orderBy: { place: "asc" },
    }),
    ...LANGUAGES.map((language) =>
      client.raceResult.aggregate({
        where: countedWhere(viewer.id, language),
        _count: { _all: true },
        _max: { cleanWpm: true },
        _avg: { cleanWpm: true },
      }),
    ),
  ]);
  const languages = {} as Record<Language, LanguageStats>;
  LANGUAGES.forEach((language, i) => {
    const a = perLanguage[i];
    languages[language] = {
      races: a?._count._all ?? 0,
      bestWpm: a?._max.cleanWpm ?? null,
      meanWpm: a?._avg.cleanWpm ?? null,
    };
  });
  const races = whole._count._all;
  const placed = (places: readonly number[]) =>
    byPlace.filter((g) => places.includes(g.place)).reduce((sum, g) => sum + g._count._all, 0);
  const service: ProfileService =
    races === 0
      ? EMPTY_SERVICE
      : {
          totalMs: whole._sum.durationMs ?? 0,
          races,
          bestWpm: whole._max.cleanWpm,
          meanWpm: whole._avg.cleanWpm,
          bestAccuracy: whole._max.accuracy,
          meanAccuracy: whole._avg.accuracy,
          wins: placed([1]),
          podiums: placed(PODIUM_PLACES),
        };
  return buildProfile(latest.map(toRow), now, {
    earliest: earliest.map(toRow),
    languages,
    service,
  });
}
