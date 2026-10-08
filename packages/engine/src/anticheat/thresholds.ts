/**
 * Thresholds of the trace analysis (ADR 0007, spec 16.3, #195). Defaults only: `analyseTrace` takes
 * them as a parameter, so the worker can re-analyse stored traces with newer values (epic #311).
 */
export type Thresholds = {
  /** `wpm-cap`: the most WPM of correct characters allowed in any window. */
  readonly MAX_WPM: number;
  /** `wpm-cap`: window length (ms); also the fixed denominator, so short races measure low. */
  readonly WINDOW_MS: number;
  /** `wpm-cap`: a window counts only with at least this many keystrokes. */
  readonly MIN_WINDOW_KEYS: number;
  /** `regular-rhythm`: coefficient of variation (stddev / mean) of inter-key intervals below this. */
  readonly MIN_CV: number;
  /** `regular-rhythm`: at least this many non-backspace keystrokes before the rule applies. */
  readonly MIN_RHYTHM_KEYS: number;
  /** `regular-rhythm`: share of intervals equal to one value (+- tolerance) above this. */
  readonly SAME_INTERVAL_RATIO: number;
  /** `regular-rhythm`: the +- tolerance (ms) of "the same interval". */
  readonly INTERVAL_TOLERANCE_MS: number;
  /** `timing-anomalies`: the server's live count above this. */
  readonly MAX_ANOMALIES: number;
  /** `timing-anomalies`: or above this share of the trace's keystrokes... */
  readonly ANOMALY_RATIO: number;
  /**
   * ...once the trace holds at least this many keystrokes. `timingAnomalies` counts batches, so on
   * a short trace the ratio would flag a single clamped batch (one Wi-Fi stall).
   */
  readonly MIN_ANOMALY_RATIO_KEYS: number;
};

export const DEFAULT_THRESHOLDS: Thresholds = Object.freeze({
  MAX_WPM: 220,
  WINDOW_MS: 10_000,
  MIN_WINDOW_KEYS: 20,
  MIN_CV: 0.12,
  MIN_RHYTHM_KEYS: 50,
  SAME_INTERVAL_RATIO: 0.9,
  INTERVAL_TOLERANCE_MS: 2,
  MAX_ANOMALIES: 20,
  ANOMALY_RATIO: 0.05,
  MIN_ANOMALY_RATIO_KEYS: 50,
});
