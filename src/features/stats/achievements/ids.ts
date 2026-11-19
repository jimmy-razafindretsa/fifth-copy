/**
 * The achievement ids (#333, #999 C34, spec 13.4 "Medals / trophies"): stable code constants. An id is
 * stored in `Achievement.achievementId` and outlives the code that awarded it: never rename or reuse
 * one; retire it by leaving it here unawarded. Names, descriptions and pins come from the catalogs
 * (C40) and the bible (C36), keyed by these ids.
 */
export const ACHIEVEMENT_IDS = [
  /** First place in a race of at least two desks (bots count). */
  "first-win",
  /** A counted race at 50 clean WPM or more (ADR 0016). */
  "wpm-50-club",
  /** A finished race with no error: 100% accuracy. */
  "accuracy-100",
  /** A finished race on an accent text (accent in every word, or special characters) at 95% accuracy or more. */
  "accent-master",
  /** Counted races on 7 stats days in a row (America/Toronto, `src/lib/time.ts`), the last one today. */
  "streak-7-days",
] as const;

export type AchievementId = (typeof ACHIEVEMENT_IDS)[number];

export function isAchievementId(id: string): id is AchievementId {
  return (ACHIEVEMENT_IDS as readonly string[]).includes(id);
}
