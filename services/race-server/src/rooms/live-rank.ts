import {
  MAX_RACE_MS,
  PLAYER_STATUS_CODES,
  PROTOCOL_VERSION,
  type RankingEntry,
  type Snapshot,
} from "@fifth-copy/protocol";
import type { RoomRuntime } from "./desks-state";
import { rankingFor } from "./ranking";

/** ms since GO on the server clock, within the wire's bounds. */
export function raceElapsed(runtime: Pick<RoomRuntime, "t0">, now: number): number {
  return Math.min(Math.max(0, now - runtime.t0), MAX_RACE_MS);
}

/**
 * The 10 Hz full state of every desk (ADR 0006 point 4, ARCHITECTURE 7.9): integer tuples
 * `[desk, cursor, correct, errors, statusCode]` by desk, and `ranks` in live order through the one
 * ranking mapper (`rankingFor`: engine `rank` and scoring only). The ranking is returned too, for
 * the events of the same tick.
 */
export function collectSnapshot(
  runtime: Pick<RoomRuntime, "desks" | "states" | "textLength">,
  elapsed: number,
): { snapshot: Snapshot; ranking: RankingEntry[] } {
  const desks: Snapshot["desks"] = [];
  for (const { desk } of runtime.desks) {
    const state = runtime.states.get(desk);
    if (!state) continue;
    desks.push([
      desk,
      state.cursor,
      state.correct,
      state.errors,
      PLAYER_STATUS_CODES[state.status],
    ]);
  }
  const ranking = rankingFor(runtime.desks, runtime.states, runtime.textLength, elapsed);
  return {
    snapshot: { v: PROTOCOL_VERSION, t: elapsed, desks, ranks: ranking.map((e) => e.desk) },
    ranking,
  };
}

export type RankDiff = {
  /** One entry per (passer, passed) pair: `desk` was behind `passed` and is now ahead of it. */
  overtakes: { desk: number; passed: number }[];
  /** The new first desk when it changed, else null. */
  newLeader: number | null;
};

/**
 * Who passed whom between two live orders (desks, first to last): every pair whose relative order
 * swapped, reported once from the desk now ahead. Desks missing from either order are ignored.
 * O(n^2), fine for 100 desks.
 */
export function diffRanks(prev: readonly number[], next: readonly number[]): RankDiff {
  const before = new Map(prev.map((desk, i) => [desk, i]));
  const after = new Map(next.map((desk, i) => [desk, i]));
  const overtakes: RankDiff["overtakes"] = [];
  for (const desk of next) {
    const was = before.get(desk);
    const is = after.get(desk)!;
    if (was === undefined) continue;
    for (const other of prev.slice(0, was)) {
      const otherNow = after.get(other);
      if (otherNow !== undefined && otherNow > is) overtakes.push({ desk, passed: other });
    }
  }
  const newLeader = prev.length > 0 && next.length > 0 && prev[0] !== next[0] ? next[0]! : null;
  return { overtakes, newLeader };
}
