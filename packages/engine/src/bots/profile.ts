import type { BotLevel, BotProfile } from "./types";

/** Target typing speed of each bot level, WPM (spec 9). */
export const BOT_LEVEL_WPM: Readonly<Record<BotLevel, number>> = {
  recruit: 20,
  clerk: 35,
  officer: 50,
  commissar: 70,
  major: 90,
};

/**
 * One row per level (#361): `errorRate` is the share of wrong keys (C4); `hesitation` the chance
 * of a long pause before punctuation and accents (at least 0.35 keeps C5's 30 % floor); `burst` the
 * strength of the fast-common-word, slow-long-word rhythm (C3). A new level is one row here.
 */
const PROFILES: Readonly<Record<BotLevel, Omit<BotProfile, "level" | "targetWpm">>> = {
  recruit: { errorRate: 0.06, hesitation: 0.6, burst: 0.4 },
  clerk: { errorRate: 0.04, hesitation: 0.5, burst: 0.35 },
  officer: { errorRate: 0.03, hesitation: 0.45, burst: 0.3 },
  commissar: { errorRate: 0.02, hesitation: 0.4, burst: 0.3 },
  major: { errorRate: 0.01, hesitation: 0.35, burst: 0.25 },
};

/** The typing profile of a bot level. */
export function botProfile(level: BotLevel): BotProfile {
  return { level, targetWpm: BOT_LEVEL_WPM[level], ...PROFILES[level] };
}
