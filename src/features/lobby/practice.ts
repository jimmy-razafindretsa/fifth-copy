import type { BotLevel, RaceSettings } from "@fifth-copy/protocol";

/** The bots a practice race seats when the caller names none (#367): two, a clerk and an officer. */
export const DEFAULT_PRACTICE_BOTS: RaceSettings["bots"] = [
  { level: "clerk" },
  { level: "officer" },
];

/**
 * The bots a new QUICK RACE room seats (#128, spec 5.3: the room never feels empty), the only place
 * the fill is written. Owner decision 2026-11-04: a random count from `min` to `max` inclusive,
 * levels taken in turn from `levels` (spec 9: Recruit 20, Clerk 35, Officer 50 WPM). The host can
 * still change them in FORM 5-L (#114).
 */
export const QUICK_RACE_BOTS = {
  min: 3,
  max: 5,
  levels: ["recruit", "clerk", "officer"],
} as const satisfies { min: number; max: number; levels: readonly BotLevel[] };

/** The fill of one new quick-race room; `rng` (a draw in [0, 1)) is injected so tests can seed it. */
export function quickRaceBots(rng: () => number): RaceSettings["bots"] {
  const { min, max, levels } = QUICK_RACE_BOTS;
  const count = Math.min(max, min + Math.floor(rng() * (max - min + 1)));
  return Array.from({ length: count }, (_, i) => ({ level: levels[i % levels.length]! }));
}
