/**
 * @fifth-copy/engine: pure, deterministic race rules shared by the race server and the browser.
 * See packages/engine/README.md and docs/adr/0007-shared-race-engine.md before adding code here.
 *
 * This file is the package's only public entry point. Modules land one card at a time
 * (docs/architecture/ARCHITECTURE.md section 11) and are re-exported from here.
 */
export * from "./types";

// text: normalisation to the typeable whitelist, word counting
export { isTypeable, normalizeTypeable, TYPEABLE } from "./text/normalize";
export { wordCount } from "./text/word-count";
export { charsOf } from "./text/chars";

// reducers: how one keystroke changes one player's state
export { applyKeystroke, BACKSPACE } from "./reducers/apply";
export { continueMode } from "./reducers/continue";
export { blockMode } from "./reducers/block";
export { backspace } from "./reducers/backspace";
export { initialState, type PlayerState } from "./reducers/state";

// scoring: the numbers shown and stored for one player (elapsed time is injected, ms since GO)
export { accuracy, elapsedFor, progress, rawWpm, wpm } from "./scoring/scoring";

// trace: the bound on one desk's stored keystrokes (race server ingest, web persistence)
export { TRACE_ALLOWANCE, TRACE_KEYS_PER_CHAR, traceCapOf } from "./trace/cap";

// anticheat: does a desk's keystroke trace look human (server at race end, worker re-analysis)
export {
  analyseTrace,
  replayTrace,
  type Flag,
  type FlagCode,
  type TraceAnalysisInput,
} from "./anticheat/analyse";
export { DEFAULT_THRESHOLDS, type Thresholds } from "./anticheat/thresholds";

// testing: the seeded PRNG of the property tests, also used by scripts/trace-fixtures.ts
export { mulberry32 } from "./testing/rng";

// ranking: one comparator for live and final order
export { compareResults, placeOf, rank, type Rankable } from "./ranking/compare";

/** Bumped whenever scoring, ranking or text handling changes. Stored on every race result. */
export const ENGINE_VERSION = "0.3.1";
