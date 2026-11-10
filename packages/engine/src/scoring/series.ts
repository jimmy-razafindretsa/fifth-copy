import { applyKeystroke } from "../reducers/apply";
import { initialState, type PlayerState } from "../reducers/state";
import type { EngineSettings, Keystroke } from "../types";
import { wpm } from "./scoring";

/** The most points a series holds (the personal card's graph, #865). */
export const MAX_SERIES_POINTS = 60;
/** The shortest bucket: a short race gets one point per second, never a burst at the first key. */
const MIN_BUCKET_MS = 1_000;

/** The clean WPM (`wpm` over base-text characters) at `t` ms since GO. */
export type WpmPoint = { readonly t: number; readonly wpm: number };

export type WpmSeriesInput = {
  readonly keystrokes: readonly Keystroke[];
  /** The text the desk typed: its effective text (base plus overlay, ADR 0016). */
  readonly text: string;
  readonly settings: EngineSettings;
  /**
   * Characters at the start of `text` that belong to the base text (`baseLengthOf`, ADR 0016): only
   * these count towards the clean WPM. Defaults to the whole text (no Extra Paperwork words).
   */
  readonly baseLength?: number;
  /** Where the series ends (the scored elapsed time); defaults to the finish, else the last key. */
  readonly endMs?: number;
  readonly maxPoints?: number;
};

function cleanCorrect(state: PlayerState, baseLength: number): number {
  if (baseLength >= state.typed.length) return state.correct;
  let correct = 0;
  for (let i = 0; i < baseLength; i++) if (state.typed[i] === null) correct += 1;
  return correct;
}

/**
 * How a desk's speed moved through its race (#865, spec 11.3): the trace replayed on its text with
 * `applyKeystroke` (as `replayTrace`), cut into equal time buckets from GO to the end (at most
 * `maxPoints`, none shorter than a second), and at the end of each bucket the clean WPM so far with
 * the same formula as `wpm()` (`cleanAndAdjustedWpm`'s clean count). So the last point is the scored
 * clean WPM. Pure and additive: scoring is unchanged. An empty trace, or one with no time, gives `[]`.
 */
export function wpmSeries({
  keystrokes,
  text,
  settings,
  baseLength = text.length,
  endMs,
  maxPoints = MAX_SERIES_POINTS,
}: WpmSeriesInput): WpmPoint[] {
  if (keystrokes.length === 0) return [];
  let end = endMs;
  if (end === undefined) {
    let state = initialState();
    for (const k of keystrokes) state = applyKeystroke(state, k, text, settings);
    end = state.finishedAt ?? state.lastT;
  }
  if (!(end > 0)) return [];
  const count = Math.max(1, Math.min(maxPoints, Math.floor(end / MIN_BUCKET_MS)));
  const points: WpmPoint[] = [];
  let state = initialState();
  let next = 0;
  for (let i = 1; i <= count; i++) {
    const t = i === count ? end : (end * i) / count;
    while (next < keystrokes.length && keystrokes[next]!.t <= t) {
      state = applyKeystroke(state, keystrokes[next]!, text, settings);
      next += 1;
    }
    points.push({ t, wpm: wpm({ correct: cleanCorrect(state, baseLength) }, t) });
  }
  return points;
}
