import type { PlayerStatus } from "../types";

/**
 * What ranking needs to know about one player. `progress` and `accuracy` are in `[0, 1]` (see
 * `scoring/`), `finishedAt` is ms since GO for a finished player, else `null`. Desks are unique
 * within a race, which makes the order strict.
 */
export type Rankable = {
  desk: number;
  status: PlayerStatus;
  progress: number;
  accuracy: number;
  finishedAt: number | null;
};

/**
 * Ranking tier per status (ADR 0007): finishers first; then every unfinished player, `asleep`,
 * `line-cut` and `expired` included, by frozen progress; Reassigned (`abandoned`) last.
 * A new status fails typecheck until it gets a tier here.
 */
const TIER: Record<PlayerStatus, number> = {
  finished: 0,
  typing: 1,
  "line-cut": 1,
  expired: 1,
  asleep: 1,
  abandoned: 2,
};

/** -1, 0 or 1 (never -0, never NaN). */
function sign(x: number): -1 | 0 | 1 {
  return x < 0 ? -1 : x > 0 ? 1 : 0;
}

/**
 * Orders two players of one race; returns exactly -1, 0 or 1. Tier first (see `TIER`); finishers by
 * `finishedAt` ascending; everyone else by `progress` descending, then `accuracy` descending; every
 * remaining tie by `desk` ascending. Live ranking (#173) and final ranking (#166, #189) both use it.
 */
export function compareResults(a: Rankable, b: Rankable): -1 | 0 | 1 {
  const tier = sign(TIER[a.status] - TIER[b.status]);
  if (tier !== 0) return tier;
  if (TIER[a.status] === TIER.finished) {
    const time = sign((a.finishedAt ?? Infinity) - (b.finishedAt ?? Infinity));
    if (time !== 0) return time;
  } else {
    const prog = sign(b.progress - a.progress);
    if (prog !== 0) return prog;
    const acc = sign(b.accuracy - a.accuracy);
    if (acc !== 0) return acc;
  }
  return sign(a.desk - b.desk);
}

/** A new array sorted best first; the input is not mutated. */
export function rank<T extends Rankable>(list: readonly T[]): T[] {
  return [...list].sort(compareResults);
}

/** 1-based place of `desk` in the race, or `0` when the desk is not in `list`. */
export function placeOf(list: readonly Rankable[], desk: number): number {
  return rank(list).findIndex((p) => p.desk === desk) + 1;
}
