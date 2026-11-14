import { type DayKey, dayKey } from "@/lib/time";

/**
 * The mission of the day and the stars (#943 parts B, bible "Home menu (extension, #943)"). Pure: no
 * I/O, the clock is an argument. A mission is one template row; the day's template is the same for
 * everyone, `MISSION_TEMPLATES[dayNumber mod length]`, on the stats day (`America/Toronto`, ADR 0008).
 * A star is one completed day; the total is derived from the results, never stored (changing this
 * list later changes past stars: accepted for v1, written in the bible).
 */

/** What a mission reads of one counted result (the Personnel file's definition, #931). */
export type MissionResult = { createdAt: Date; accuracy: number };

export type MissionId = "accuracy-95" | "finish-3" | "accuracy-98";

export type MissionTemplate = {
  id: MissionId;
  /** How many counting results of the day complete it. */
  target: number;
  /** Whether one counted result counts towards it. */
  counts: (result: MissionResult) => boolean;
};

/** The v1 rotation, in order (one row per mission). */
export const MISSION_TEMPLATES: readonly [MissionTemplate, ...MissionTemplate[]] = [
  { id: "accuracy-95", target: 3, counts: (r) => r.accuracy >= 0.95 },
  { id: "finish-3", target: 3, counts: () => true },
  { id: "accuracy-98", target: 1, counts: (r) => r.accuracy >= 0.98 },
];

const DAY_MS = 86_400_000;

/** Days from 1970-01-01 to the stats day `key` (calendar arithmetic, no zone). */
export function dayNumber(key: DayKey): number {
  const [y, m, d] = key.split("-").map(Number);
  return Math.round(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / DAY_MS);
}

/** The template of the stats day `key`. */
export function missionForDay(key: DayKey): MissionTemplate {
  const list = MISSION_TEMPLATES;
  const index = ((dayNumber(key) % list.length) + list.length) % list.length;
  return list[index] ?? list[0];
}

/** The template of the stats day an instant falls on. */
export function missionFor(at: Date): MissionTemplate {
  return missionForDay(dayKey(at));
}

export type MissionProgress = {
  id: MissionId;
  target: number;
  /** Counting results of the day, capped at the target. */
  progress: number;
  complete: boolean;
};

/** How many of `results` count towards the mission of `key`, uncapped (results of other days ignored). */
function countedOn(key: DayKey, results: readonly MissionResult[]): number {
  const mission = missionForDay(key);
  return results.filter((r) => dayKey(r.createdAt) === key && mission.counts(r)).length;
}

/** Today's mission and the viewer's progress on it. */
export function missionProgress(results: readonly MissionResult[], now: Date): MissionProgress {
  const key = dayKey(now);
  const { id, target } = missionForDay(key);
  const progress = Math.min(target, countedOn(key, results));
  return { id, target, progress, complete: progress >= target };
}

/** The star total: distinct stats days whose results complete that day's mission. */
export function starTotal(results: readonly MissionResult[]): number {
  const byDay = new Map<DayKey, MissionResult[]>();
  for (const r of results) {
    const key = dayKey(r.createdAt);
    const list = byDay.get(key);
    if (list) list.push(r);
    else byDay.set(key, [r]);
  }
  let stars = 0;
  for (const [key, list] of byDay) {
    if (countedOn(key, list) >= missionForDay(key).target) stars += 1;
  }
  return stars;
}

/** What the menu shows: today's mission and the star total (`getMissions`). */
export type Missions = { today: MissionProgress; stars: number };

export function buildMissions(results: readonly MissionResult[], now: Date): Missions {
  return { today: missionProgress(results, now), stars: starTotal(results) };
}
