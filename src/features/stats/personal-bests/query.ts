import "server-only";
import type { db as appDb } from "@/server/db";
import type { BestKey } from "./rule";

/** Who is looking: only the id matters (ADR 0009). */
type BestsViewer = { id: string } | null;

type Db = { personalBest: Pick<typeof appDb.personalBest, "findMany"> };

/** One stored personal best (clean WPM, ADR 0016). */
export type PersonalBestRow = BestKey & {
  cleanWpm: number;
  accuracy: number;
  /** The race that set it; null once that race row is gone. */
  raceId: string | null;
  achievedAt: Date;
};

/**
 * The viewer's personal bests (#999 C41), one per language, text type and length, fastest first.
 * Only ever the viewer's own rows; a visitor has none. Flagged results never set a best (`rule.ts`),
 * so nothing here needs filtering again.
 */
export async function getPersonalBests(
  viewer: BestsViewer,
  { db }: { db?: Db } = {},
): Promise<PersonalBestRow[]> {
  if (!viewer) return [];
  const client: Db = db ?? (await import("@/server/db")).db;
  return client.personalBest.findMany({
    where: { userId: viewer.id },
    select: {
      language: true,
      textType: true,
      length: true,
      cleanWpm: true,
      accuracy: true,
      raceId: true,
      achievedAt: true,
    },
    orderBy: [{ cleanWpm: "desc" }, { achievedAt: "asc" }],
  });
}
