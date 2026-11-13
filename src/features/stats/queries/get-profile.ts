import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { COUNTED_RACE } from "@/features/results";
import type { db as appDb } from "@/server/db";
import {
  buildProfile,
  GAIN_SAMPLE,
  LANGUAGES,
  type LanguageStats,
  type Language,
  type Profile,
  type ResultRow,
  SERIES_LIMIT,
} from "../view/profile";

/** Who is looking: only the id matters (ADR 0009); guests have a file too. */
type ProfileViewer = { id: string } | null;

type Db = { raceResult: Pick<typeof appDb.raceResult, "findMany" | "aggregate"> };

/** The statuses a counted result has (#931): a desk that finished or ran out of time. */
const COUNTED_STATUSES = ["FINISHED", "TIMED_OUT"] as const;

/** A counted result of `userId` (#931 definitions, ADR 0008): never a bot's, a flagged or a voided race's. */
function countedWhere(userId: string, language?: Language): Prisma.RaceResultWhereInput {
  return {
    userId,
    isBot: false,
    suspicious: false,
    status: { in: [...COUNTED_STATUSES] },
    race: language ? { ...COUNTED_RACE, textLanguage: language } : COUNTED_RACE,
  };
}

/** Only what the view reads: `cleanWpm` (ADR 0016), never `wpm`, `rawWpm` or `adjustedWpm`. */
const ROW_SELECT = {
  createdAt: true,
  cleanWpm: true,
  accuracy: true,
  race: { select: { textLanguage: true } },
} satisfies Prisma.RaceResultSelect;

type Selected = Prisma.RaceResultGetPayload<{ select: typeof ROW_SELECT }>;

const toRow = (r: Selected): ResultRow => ({
  createdAt: r.createdAt,
  cleanWpm: r.cleanWpm,
  accuracy: r.accuracy,
  language: r.race.textLanguage,
});

/**
 * The viewer's Personnel file (#931, spec 13.2, ADR 0008, 0009, 0016): their own counted results only,
 * read from `RaceResult` (never `RaceKeystrokes`). A constant number of queries whatever the file's size:
 * the latest `SERIES_LIMIT` results, the earliest `GAIN_SAMPLE`, and one aggregate per language for the
 * whole-file totals and bests. A `null` viewer gets the empty profile without a query.
 */
export async function getProfile(
  viewer: ProfileViewer,
  { db, now = new Date() }: { db?: Db; now?: Date } = {},
): Promise<Profile> {
  if (!viewer) return buildProfile([], now);
  const client: Db = db ?? (await import("@/server/db")).db;
  const where = countedWhere(viewer.id);
  const [latest, earliest, ...perLanguage] = await Promise.all([
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
  return buildProfile(latest.map(toRow), now, { earliest: earliest.map(toRow), languages });
}
