/**
 * The award rules (#333, #999 C35, spec 13.4), pure: which achievements one filed result earns. Only a
 * counted result earns anything (`isCountedResult`: never a bot, never a flagged result, ADR 0008);
 * speed is clean WPM only (ADR 0016). "At most once" is the table's key (`award.ts`), not these rules.
 */
import { addDays, type DayKey } from "@/lib/time";
import { isCountedResult, type CountableResult } from "../counted";
import type { AchievementId } from "./ids";

/** The 50 WPM club's threshold, in clean WPM. */
export const WPM_CLUB = 50;
/** Accent master's least accuracy (0..1). */
export const ACCENT_MASTER_ACCURACY = 0.95;
/** The streak's length in stats days. */
export const STREAK_DAYS = 7;
/** Accuracy is a 0..1 float: 100% with a hair of tolerance. */
const PERFECT = 1 - 1e-9;

export type AwardFacts = {
  result: CountableResult & { place: number; cleanWpm: number; accuracy: number };
  race: {
    /** Desks at the start (bots count). */
    lobbySize: number;
    /** From the stored settings: `accentEveryWord`, or a `special-characters` text. */
    accentText: boolean;
  };
  /**
   * Consecutive stats days, ending today, with a counted race (`dayStreak`), this result included;
   * `null` when it was not computed (the typist already holds the streak achievement).
   */
  streakDays: number | null;
};

/** The achievements `facts` earn, in `ACHIEVEMENT_IDS` order. */
export function earnedBy({ result, race, streakDays }: AwardFacts): AchievementId[] {
  if (!isCountedResult(result)) return [];
  const finished = result.status === "FINISHED";
  const earned: AchievementId[] = [];
  if (result.place === 1 && race.lobbySize >= 2) earned.push("first-win");
  if (result.cleanWpm >= WPM_CLUB) earned.push("wpm-50-club");
  if (finished && result.accuracy >= PERFECT) earned.push("accuracy-100");
  if (finished && race.accentText && result.accuracy >= ACCENT_MASTER_ACCURACY - 1e-9) {
    earned.push("accent-master");
  }
  if (streakDays !== null && streakDays >= STREAK_DAYS) earned.push("streak-7-days");
  return earned;
}

/** The number of consecutive stats days ending on `today` found in `days` (0 when `today` is absent). */
export function dayStreak(days: Iterable<DayKey>, today: DayKey): number {
  const set = new Set(days);
  let n = 0;
  while (set.has(addDays(today, -n))) n += 1;
  return n;
}
