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
 * The one mapper from desk states to the wire ranking (ADR 0007): order only through the engine's
 * `rank`, figures only through its scoring. A desk without a state scores as `initialState()`.
 * Elapsed per `elapsedFor`'s guidance: finish time for a finisher, race end for a desk still
 * `typing`, last keystroke for every other status, so idle time never deflates WPM. Reused by the
 * live ranking (#173) and persistence (#189).
 */
export function rankingFor(
  desks: readonly RaceDesk[],
  states: ReadonlyMap<number, PlayerState>,
  textLength: number,
  raceElapsedMs: number,
): RankingEntry[] {
  const scored = desks.map(({ desk, name, isBot }) => {
    const state = states.get(desk) ?? initialState();
    const elapsed = elapsedFor(state, state.status === "typing" ? raceElapsedMs : state.lastT);
    return {
      desk,
      name,
      isBot,
      status: state.status,
      wpm: wpm(state, elapsed),
      rawWpm: rawWpm(state, elapsed),
      accuracy: accuracy(state),
      progress: progress(state, textLength),
      finishedAt: state.finishedAt,
    };
  });
  return rank(scored).map((entry, i) => ({ place: i + 1, ...entry }));
}
