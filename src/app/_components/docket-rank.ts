import type { DocketRank } from "@/features/landing";
import { rankFor, rankIndex } from "@/features/stats";

/**
 * The player docket's rank (#945 C1): the stats feature's scale over the mean clean WPM, with the names
 * of the viewer's catalog (`ranks`, in `BOT_LEVELS` order). The route resolves it so the landing never
 * imports the stats index.
 */
export function docketRank(meanWpm: number | null, ranks: readonly string[]): DocketRank {
  const step = rankFor(meanWpm);
  const name = (level: typeof step.rank) => ranks[rankIndex(level)] ?? level;
  return {
    level: step.rank,
    name: name(step.rank),
    meanWpm: meanWpm ?? 0,
    next:
      step.nextRank !== null && step.nextAt !== null
        ? { name: name(step.nextRank), at: step.nextAt, progress: step.progress }
        : null,
  };
}
