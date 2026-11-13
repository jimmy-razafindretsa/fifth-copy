import { BOT_LEVEL_WPM, BOT_LEVELS, type BotLevel } from "@fifth-copy/engine";

/**
 * The player-rank scale (#945 C1, spec 13.4 "Ranks by average WPM", `packages/engine/README.md`): the
 * rank is the highest level of `BOT_LEVELS` whose `BOT_LEVEL_WPM` is at or below the mean clean WPM
 * (ADR 0016) over the counted races; below the second level, or with no counted race, Recruit. The
 * thresholds are the engine's, never a second copy. Level `major` displays as HERO OF PAPERWORK (the
 * catalogs' rank list, by index). Pure; #337 (rank on the Personnel file) reuses it.
 */
export type RankStep = {
  rank: BotLevel;
  /** The next level up, or null at the top. */
  nextRank: BotLevel | null;
  /** The mean WPM that reaches `nextRank`, or null at the top. */
  nextAt: number | null;
  /** Share (0..1) of the way from the current rank's floor (0 for Recruit) to `nextAt`; 1 at the top. */
  progress: number;
};

/** The floor of a level: 0 for the first (Recruit), else its bot WPM. */
const floorOf = (index: number): number => {
  const level = BOT_LEVELS[index];
  return index === 0 || level === undefined ? 0 : BOT_LEVEL_WPM[level];
};

export function rankFor(meanWpm: number | null): RankStep {
  const wpm = meanWpm ?? 0;
  let index = 0;
  for (let i = 1; i < BOT_LEVELS.length; i++) if (wpm >= floorOf(i)) index = i;
  const rank = BOT_LEVELS[index] ?? BOT_LEVELS[0];
  const nextRank = BOT_LEVELS[index + 1] ?? null;
  if (nextRank === null) return { rank, nextRank: null, nextAt: null, progress: 1 };
  const floor = floorOf(index);
  const nextAt = BOT_LEVEL_WPM[nextRank];
  const progress = Math.max(0, Math.min(1, (wpm - floor) / (nextAt - floor)));
  return { rank, nextRank, nextAt, progress };
}

/** The index of a level in `BOT_LEVELS` (the catalogs' rank names are listed in this order). */
export const rankIndex = (level: BotLevel): number => BOT_LEVELS.indexOf(level);
