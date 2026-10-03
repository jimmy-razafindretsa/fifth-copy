/**
 * @fifth-copy/engine: pure, deterministic race rules shared by the race server and the browser.
 * See packages/engine/README.md and docs/adr/0007-shared-race-engine.md before adding code here.
 *
 * This file is the package's only public entry point. Modules land one card at a time
 * (docs/architecture/ARCHITECTURE.md section 11) and are re-exported from here.
 */
export * from "./types";

/** Bumped whenever scoring, ranking or text handling changes. Stored on every race result. */
export const ENGINE_VERSION = "0.1.0";
