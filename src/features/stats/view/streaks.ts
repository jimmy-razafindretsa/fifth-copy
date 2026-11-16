/**
 * Clean streaks (#936, bible 14.3 "Séries sans faute", spec 13.2, ADR 0016): for each accuracy threshold,
 * the longest run of consecutive counted races at or above it, the mean clean WPM of that run, and the
 * run that ends at the latest race. Pure: the query (`queries/get-profile.ts`) reads one narrow scan of
 * the viewer's counted results, capped at `STREAK_SCAN_LIMIT` latest rows, so a run older than that cap
 * is not seen (stated, accepted for v1); computed on read, never stored.
 */

/** The thresholds the docket lists, in percent, in its row order. */
export const STREAK_THRESHOLDS = [100, 98, 95, 90] as const;
export type StreakThreshold = (typeof STREAK_THRESHOLDS)[number];

/** The streak scan reads at most this many latest counted results. */
export const STREAK_SCAN_LIMIT = 5_000;

/** What a streak needs of a result, nothing more (accuracy 0..1, clean WPM, its instant). */
export type StreakRow = { createdAt: Date; cleanWpm: number; accuracy: number };

export type ProfileStreak = {
  threshold: StreakThreshold;
  /** The longest run of consecutive races at or above the threshold; 0 when none. */
  best: number;
  /** Mean clean WPM of that run (the latest one when several tie); `null` when `best` is 0. */
  wpmDuring: number | null;
  /** The run that ends at the latest race; 0 when that race is under the threshold. */
  current: number;
};

/** Accuracy is stored as a 0..1 float: compare in percent with a hair of tolerance (0.95 -> 95). */
const atOrAbove = (accuracy: number, threshold: number) => accuracy * 100 >= threshold - 1e-9;

/** One threshold over `rows` in race order. */
function streakAt(rows: StreakRow[], threshold: StreakThreshold): ProfileStreak {
  let best = 0;
  let bestSum = 0;
  let run = 0;
  let sum = 0;
  for (const row of rows) {
    if (atOrAbove(row.accuracy, threshold)) {
      run += 1;
      sum += row.cleanWpm;
      // `>=`: a later run of the same length replaces the earlier one (the latest wins a tie)
      if (run >= best) {
        best = run;
        bestSum = sum;
      }
    } else {
      run = 0;
      sum = 0;
    }
  }
  return { threshold, best, wpmDuring: best === 0 ? null : bestSum / best, current: run };
}

/** The four streaks of a file, from its counted results in any order. */
export function streaksOf(rows: StreakRow[]): ProfileStreak[] {
  const ordered = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return STREAK_THRESHOLDS.map((threshold) => streakAt(ordered, threshold));
}
