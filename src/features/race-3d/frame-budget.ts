import type { SceneTelemetry } from "./messages";

/**
 * The running seat scene's frame budget (#695, ADR 0013 "benchmark below the Low threshold shows a 2D
 * paper race view", bible 12). The scene shares the page's main thread (ADR 0017 Considerations): a scene
 * that cannot hold Low's floor starves the HUD's timers and input, so the page drops it for the paper
 * backdrop. The thresholds are stated here once (#275's fps gate reads the same numbers).
 */

/** Bible 12's Low floor: under it the scene costs the race more than it shows. */
export const SCENE_MIN_FPS = 18;
/** Consecutive slow telemetry seconds before the page falls back. */
export const SCENE_BUDGET_STRIKES = 3;

export type FrameBudget = { strikes: number; verdict: "keep" | "fallback" };

export const FRAME_BUDGET_START: FrameBudget = Object.freeze({ strikes: 0, verdict: "keep" });

/**
 * One telemetry second through the budget: a second under `SCENE_MIN_FPS` that is not a browser cap
 * (`capped`, bible 12: a flat 30 fps cap is never a failure) is a strike; any other second resets the
 * count; `SCENE_BUDGET_STRIKES` strikes in a row is `fallback`, which is final. Pure.
 */
export function frameBudget(previous: FrameBudget, telemetry: SceneTelemetry): FrameBudget {
  if (previous.verdict === "fallback") return previous;
  const slow = telemetry.fps < SCENE_MIN_FPS && !telemetry.capped;
  const strikes = slow ? previous.strikes + 1 : 0;
  return { strikes, verdict: strikes >= SCENE_BUDGET_STRIKES ? "fallback" : "keep" };
}
