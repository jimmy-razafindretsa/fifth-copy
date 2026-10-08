import {
  accuracy,
  elapsedFor,
  initialState,
  progress,
  rank,
  rawWpm,
  wpm,
  type PlayerState,
} from "@fifth-copy/engine";
import type { RankingEntry } from "@fifth-copy/protocol";
import type { RaceDesk } from "./registry";

/**
 * A desk's scoring time per `elapsedFor`'s guidance: finish time for a finisher, race end for a desk
 * still `typing`, last keystroke for every other status, so idle time never deflates WPM. Shared by
 * the ranking and the stored `durationMs` (#189).
 */
export const elapsedOf = (state: PlayerState, raceElapsedMs: number) =>
  elapsedFor(state, state.status === "typing" ? raceElapsedMs : state.lastT);

/** A desk's state as ranked: `textLength` is its effective text's (#190), else the base's. */
export type RankedState = PlayerState & { readonly textLength?: number };

/**
 * The one mapper from desk states to the wire ranking (ADR 0007): order only through the engine's
 * `rank`, figures only through its scoring. A desk without a state scores as `initialState()`.
 * Elapsed per `elapsedOf`. Progress is over the desk's own effective text (#190, ADR 0007: finish
 * order by effective-text completion), `textLength` for a desk without one. Reused by the live
 * ranking (#173), the race end (#166), the bonus step (#190) and persistence (#189).
 */
export function rankingFor(
  desks: readonly RaceDesk[],
  states: ReadonlyMap<number, RankedState>,
  textLength: number,
  raceElapsedMs: number,
): RankingEntry[] {
  const scored = desks.map(({ desk, name, isBot }) => {
    const state: RankedState = states.get(desk) ?? initialState();
    const elapsed = elapsedOf(state, raceElapsedMs);
    return {
      desk,
      name,
      isBot,
      status: state.status,
      wpm: wpm(state, elapsed),
      rawWpm: rawWpm(state, elapsed),
      accuracy: accuracy(state),
      progress: progress(state, state.textLength ?? textLength),
      finishedAt: state.finishedAt,
    };
  });
  return rank(scored).map((entry, i) => ({ place: i + 1, ...entry }));
}
