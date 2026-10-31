import { describe, expect, it } from "vitest";
import {
  FRAME_BUDGET_START,
  frameBudget,
  SCENE_BUDGET_STRIKES,
  SCENE_MIN_FPS,
  type FrameBudget,
} from "./frame-budget";
import type { SceneTelemetry } from "./messages";

// Contract of #695 C1 (ADR 0013 fallback below Low, bible 12): the running scene falls back to paper after
// SCENE_BUDGET_STRIKES consecutive telemetry seconds under SCENE_MIN_FPS that are not a browser cap.

const second = (fps: number, capped = false): SceneTelemetry => ({
  fps,
  calls: 40,
  triangles: 120_000,
  preset: "high",
  capped,
});

/** The verdicts after each second of `seconds`, from the start. */
function run(seconds: SceneTelemetry[]): FrameBudget[] {
  const out: FrameBudget[] = [];
  let state = FRAME_BUDGET_START;
  for (const s of seconds) out.push((state = frameBudget(state, s)));
  return out;
}
const verdicts = (seconds: SceneTelemetry[]) => run(seconds).map((s) => s.verdict);
const repeat = <T>(n: number, s: T): T[] => Array.from({ length: n }, () => s);

describe("frameBudget (#695 C1)", () => {
  it("states the thresholds once: bible 12's Low floor and three strikes", () => {
    expect(SCENE_MIN_FPS).toBe(18);
    expect(SCENE_BUDGET_STRIKES).toBe(3);
    expect(FRAME_BUDGET_START).toEqual({ strikes: 0, verdict: "keep" });
  });

  const table: [string, SceneTelemetry[], FrameBudget["verdict"][]][] = [
    ["steady 60", repeat(10, second(60)), repeat(10, "keep")],
    ["steady 12", repeat(4, second(12)), ["keep", "keep", "fallback", "fallback"]],
    [
      "12-12-30-12-12-12",
      [12, 12, 30, 12, 12, 12].map((f) => second(f)),
      ["keep", "keep", "keep", "keep", "keep", "fallback"],
    ],
    ["capped 30 forever", repeat(20, second(30, true)), repeat(20, "keep")],
    ["12-capped-12", [second(12), second(12, true), second(12)], ["keep", "keep", "keep"]],
  ];
  it.each(table)("%s", (_name, seconds, expected) => {
    expect(verdicts(seconds)).toEqual(expected);
  });

  it("counts consecutive slow seconds and resets on a good or a capped one", () => {
    expect(run([second(12), second(12), second(30)]).map((s) => s.strikes)).toEqual([1, 2, 0]);
    expect(run([second(12), second(12, true)]).map((s) => s.strikes)).toEqual([1, 0]);
    // the floor itself is not a strike: fps < SCENE_MIN_FPS
    expect(run(repeat(5, second(SCENE_MIN_FPS))).map((s) => s.strikes)).toEqual([0, 0, 0, 0, 0]);
  });

  it("a fallback is final: later good seconds never bring the scene back", () => {
    const state = run(repeat(SCENE_BUDGET_STRIKES, second(5))).at(-1)!;
    expect(state.verdict).toBe("fallback");
    expect(frameBudget(state, second(60)).verdict).toBe("fallback");
  });

  it("is pure: the previous state is never written", () => {
    const previous = Object.freeze({ strikes: 1, verdict: "keep" as const });
    expect(frameBudget(previous, second(10))).toEqual({ strikes: 2, verdict: "keep" });
    expect(previous).toEqual({ strikes: 1, verdict: "keep" });
  });
});
