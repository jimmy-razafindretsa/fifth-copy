import { applyKeystroke, BACKSPACE } from "../reducers/apply";
import { initialState, type PlayerState } from "../reducers/state";
import type { EngineSettings, Keystroke } from "../types";
import { DEFAULT_THRESHOLDS, type Thresholds } from "./thresholds";

/** Why a trace does not look human (spec 16.3, ADR 0007). Neutral codes: a flag is for review. */
export type FlagCode =
  "non-monotonic" | "unreproducible" | "wpm-cap" | "regular-rhythm" | "timing-anomalies";

/**
 * One finding on a trace. `detail` holds numbers only (`cv=0.004`): it is stored on a student's
 * result row (docs/privacy/inventory.md), so never names or typed text.
 */
export type Flag = { readonly code: FlagCode; readonly detail?: string };

/** What the server holds of one desk at race end (#195). */
export type TraceAnalysisInput = {
  /** The desk's trace, as applied (`DeskState.trace`) or as stored. */
  readonly keystrokes: readonly Keystroke[];
  /** The race text, already `normalizeTypeable`d (as `applyKeystroke` requires). */
  readonly text: string;
  readonly settings: EngineSettings;
  /** The counters the server recorded for the desk; the replay must reproduce them. */
  readonly recorded: { readonly cursor: number; readonly correct: number; readonly errors: number };
  /** The server's live count of batches with a clamped, non-monotonic or stale `t` (#173). */
  readonly timingAnomalies: number;
};

/** The final state of replaying `keystrokes` from `initialState()` through the engine. */
export function replayTrace(
  keystrokes: readonly Keystroke[],
  text: string,
  settings: EngineSettings,
): PlayerState {
  let state = initialState();
  for (const k of keystrokes) state = applyKeystroke(state, k, text, settings);
  return state;
}

/** Built once per analysis: one replay serves `unreproducible` and `wpm-cap`. */
type Context = {
  readonly input: TraceAnalysisInput;
  readonly final: PlayerState;
  /** `correctAfter[i]`: the replay's `correct` after keystroke `i`. */
  readonly correctAfter: readonly number[];
};
type Rule = (ctx: Context, thresholds: Thresholds) => Flag | null;

const num = (x: number, digits = 3) => String(Number(x.toFixed(digits)));

const nonMonotonic: Rule = ({ input: { keystrokes } }) => {
  for (let i = 1; i < keystrokes.length; i++) {
    if (keystrokes[i]!.t < keystrokes[i - 1]!.t)
      return { code: "non-monotonic", detail: `at=${i}` };
  }
  return null;
};

const unreproducible: Rule = ({ input: { recorded }, final }) =>
  final.cursor === recorded.cursor &&
  final.correct === recorded.correct &&
  final.errors === recorded.errors
    ? null
    : {
        code: "unreproducible",
        detail: `cursor=${final.cursor}/${recorded.cursor};correct=${final.correct}/${recorded.correct};errors=${final.errors}/${recorded.errors}`,
      };

/**
 * Correct characters inside every window `[t_i - WINDOW_MS, t_i]` ending at a keystroke, two
 * pointers (O(n)). The denominator is always `WINDOW_MS`: sustained speed, never a burst.
 */
const wpmCap: Rule = ({ input: { keystrokes }, correctAfter }, th) => {
  let best = 0;
  let start = 0;
  for (let i = 0; i < keystrokes.length; i++) {
    const from = keystrokes[i]!.t - th.WINDOW_MS;
    while (start < i && keystrokes[start]!.t < from) start++;
    if (i - start + 1 < th.MIN_WINDOW_KEYS) continue;
    const before = start === 0 ? 0 : correctAfter[start - 1]!;
    const wpm = (correctAfter[i]! - before) / 5 / (th.WINDOW_MS / 60_000);
    if (wpm > best) best = wpm;
  }
  return best > th.MAX_WPM ? { code: "wpm-cap", detail: `wpm=${num(best, 1)}` } : null;
};

/**
 * Inter-key intervals between consecutive non-backspace keystrokes: coefficient of variation, and
 * the largest share of intervals within +- tolerance of one value (buckets by rounded ms, O(n)).
 */
const regularRhythm: Rule = ({ input: { keystrokes } }, th) => {
  const times: number[] = [];
  for (const k of keystrokes) if (k.key !== BACKSPACE) times.push(k.t);
  if (times.length < th.MIN_RHYTHM_KEYS) return null;
  const n = times.length - 1;
  let sum = 0;
  let sumSq = 0;
  const buckets = new Map<number, number>();
  for (let i = 1; i < times.length; i++) {
    const d = times[i]! - times[i - 1]!;
    sum += d;
    sumSq += d * d;
    const b = Math.round(d);
    buckets.set(b, (buckets.get(b) ?? 0) + 1);
  }
  const mean = sum / n;
  const cv = mean > 0 ? Math.sqrt(Math.max(0, sumSq / n - mean * mean)) / mean : 0;
  let same = 0;
  for (const v of buckets.keys()) {
    let count = 0;
    for (let d = -th.INTERVAL_TOLERANCE_MS; d <= th.INTERVAL_TOLERANCE_MS; d++) {
      count += buckets.get(v + d) ?? 0;
    }
    if (count > same) same = count;
  }
  const ratio = same / n;
  return cv < th.MIN_CV || ratio > th.SAME_INTERVAL_RATIO
    ? { code: "regular-rhythm", detail: `cv=${num(cv)};same=${num(ratio)}` }
    : null;
};

const timingAnomalies: Rule = ({ input: { keystrokes, timingAnomalies: count } }, th) => {
  const overRatio =
    keystrokes.length >= th.MIN_ANOMALY_RATIO_KEYS && count > th.ANOMALY_RATIO * keystrokes.length;
  return count > th.MAX_ANOMALIES || overRatio
    ? { code: "timing-anomalies", detail: `count=${count};keys=${keystrokes.length}` }
    : null;
};

/** Fixed order, so the output order is deterministic. One function per rule; add one here. */
const RULES: readonly Rule[] = [
  nonMonotonic,
  unreproducible,
  wpmCap,
  regularRhythm,
  timingAnomalies,
];

/**
 * Whether one desk's keystroke trace looks human (ADR 0007, spec 16.3, #195): `[]` when it does,
 * else one flag per failed rule. Pure and deterministic; never mutates its input; every rule is
 * O(n) over a trace bounded by `traceCapOf`. Thresholds are injected (worker re-analysis, #311).
 */
export function analyseTrace(
  input: TraceAnalysisInput,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): Flag[] {
  let state = initialState();
  const correctAfter: number[] = [];
  for (const k of input.keystrokes) {
    state = applyKeystroke(state, k, input.text, input.settings);
    correctAfter.push(state.correct);
  }
  const ctx: Context = { input, final: state, correctAfter };
  const flags: Flag[] = [];
  for (const rule of RULES) {
    const flag = rule(ctx, thresholds);
    if (flag) flags.push(flag);
  }
  return flags;
}
