import "server-only";
import type { db as appDb } from "@/server/db";
import { rankFor, type RankStep } from "../view/rank";
import { countedWhere } from "./counted-where";

/** Who is looking: only the id matters (ADR 0009). */
type RankViewer = { id: string };

type Db = { raceResult: Pick<typeof appDb.raceResult, "aggregate"> };

/**
 * The viewer's grade for the site header (#969 C1, ADR 0016): one aggregate over their counted results
 * (`countedWhere`, the Personnel file's filter), the mean clean WPM, then `rankFor` (the engine's scale;
 * no threshold here). No counted race: Recruit. Creates nothing; never cached across requests.
 */
export async function getRank(viewer: RankViewer, { db }: { db?: Db } = {}): Promise<RankStep> {
  const client: Db = db ?? (await import("@/server/db")).db;
  const { _avg } = await client.raceResult.aggregate({
    where: countedWhere(viewer.id),
    _avg: { cleanWpm: true },
  });
  return rankFor(_avg.cleanWpm ?? null);
}
