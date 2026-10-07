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

/** Bumped whenever scoring, ranking or text handling changes. Stored on every race result. */
export const ENGINE_VERSION = "0.2.0";
