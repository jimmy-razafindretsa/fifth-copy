import { describe, expect, it } from "vitest";
import { BACKSPACE } from "../reducers/apply";
import { mulberry32 } from "../testing/rng";
import type { Keystroke } from "../types";
import { analyseTrace, replayTrace, type TraceAnalysisInput } from "./analyse";
import human1 from "./fixtures/human-1.json";
import human2 from "./fixtures/human-2.json";
import human3 from "./fixtures/human-3.json";
import scriptedConstant from "./fixtures/scripted-constant.json";
import scriptedFast from "./fixtures/scripted-fast.json";
import scriptedJittered from "./fixtures/scripted-jittered.json";
import { DEFAULT_THRESHOLDS } from "./thresholds";

// #195: does a desk's keystroke trace look human (ADR 0007, spec 16.3).

type Fixture = TraceAnalysisInput & { seed: number };
const asInput = (f: unknown) => f as Fixture;
const HUMANS = { "human-1": human1, "human-2": human2, "human-3": human3 };
const codes = (input: TraceAnalysisInput, th = DEFAULT_THRESHOLDS) =>
  analyseTrace(input, th).map((f) => f.code);

/** The fixture's trace with `recorded` recomputed by the engine, so only the rule under test fires. */
function withTrace(base: TraceAnalysisInput, keystrokes: Keystroke[]): TraceAnalysisInput {
  const s = replayTrace(keystrokes, base.text, base.settings);
  return {
    ...base,
    keystrokes,
    recorded: { cursor: s.cursor, correct: s.correct, errors: s.errors },
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

describe("analyseTrace tables (C1)", () => {
  it.each(Object.entries(HUMANS))("%s yields no flag", (_name, fixture) => {
    const input = asInput(fixture);
    expect(input.keystrokes.length).toBeGreaterThanOrEqual(DEFAULT_THRESHOLDS.MIN_RHYTHM_KEYS);
    expect(input.keystrokes.some((k) => k.key === BACKSPACE)).toBe(true); // corrections
    expect(analyseTrace(input)).toEqual([]);
  });

  it.each([
    ["scripted-constant", scriptedConstant],
    ["scripted-jittered", scriptedJittered],
  ])("%s yields regular-rhythm", (_name, fixture) => {
    expect(codes(asInput(fixture))).toEqual(["regular-rhythm"]);
  });

  it("scripted-fast (300 WPM) yields wpm-cap", () => {
    expect(codes(asInput(scriptedFast))).toEqual(["wpm-cap"]);
  });

  it("one decreasing t yields non-monotonic", () => {
    const base = asInput(human1);
    const keys = base.keystrokes.map((k) => ({ ...k }));
    keys[40] = { ...keys[40]!, t: keys[39]!.t - 5 };
    expect(codes(withTrace(base, keys))).toEqual(["non-monotonic"]);
  });

  it("a trace whose last keystroke was removed from the recorded state yields unreproducible", () => {
    const base = asInput(human2);
    const short = withTrace(base, base.keystrokes.slice(0, -1));
    const input = { ...base, recorded: short.recorded };
    expect(codes(input)).toEqual(["unreproducible"]);
  });

  it("timingAnomalies: 25 yields timing-anomalies; the ratio applies from MIN_ANOMALY_RATIO_KEYS", () => {
    const human = asInput(human3);
    expect(codes({ ...human, timingAnomalies: 25 })).toEqual(["timing-anomalies"]);
    expect(codes({ ...human, timingAnomalies: 20 })).toEqual([]);
    // 428 keys: 5 % is 21.4, so the absolute cap decides here; a 100-key trace flags at 6.
    const hundred = withTrace(human, human.keystrokes.slice(0, 100));
    expect(codes({ ...hundred, timingAnomalies: 6 })).toEqual(["timing-anomalies"]);
    expect(codes({ ...hundred, timingAnomalies: 5 })).toEqual([]);
    // Under 50 keys a single stalled batch is not a ratio over 5 %.
    const short = withTrace(human, human.keystrokes.slice(0, 30));
    expect(codes({ ...short, timingAnomalies: 3 })).toEqual([]);
  });

  it("injected thresholds are honoured: MIN_CV 0.5 flips a human fixture to flagged", () => {
    const input = asInput(human1);
    expect(analyseTrace(input)).toEqual([]);
    expect(codes(input, { ...DEFAULT_THRESHOLDS, MIN_CV: 0.5 })).toEqual(["regular-rhythm"]);
  });

  it("detail carries numbers only, never typed text", () => {
    const fixtures = [scriptedConstant, scriptedFast, scriptedJittered].map(asInput);
    for (const f of fixtures) {
      for (const flag of analyseTrace({ ...f, timingAnomalies: 30 })) {
        expect(flag.detail).toMatch(/^([a-z]+=[\d./]+;?)+$/);
      }
    }
  });
});

describe("analyseTrace properties (C2)", () => {
  it("is pure and deterministic on frozen inputs", () => {
    for (const fixture of [human1, scriptedConstant, scriptedFast]) {
      const input = deepFreeze(structuredClone(asInput(fixture)));
      const thresholds = deepFreeze({ ...DEFAULT_THRESHOLDS });
      const first = analyseTrace(input, thresholds);
      expect(analyseTrace(input, thresholds)).toEqual(first);
      expect(input).toEqual(asInput(fixture));
    }
  });

  it("traces under 20 keystrokes never yield wpm-cap; under 50 never regular-rhythm", () => {
    const rng = mulberry32(195);
    const text = asInput(scriptedFast).text;
    for (let run = 0; run < 50; run++) {
      const n = 1 + Math.floor(rng() * 49);
      // Impossibly fast (1 ms apart) and perfectly regular, all correct.
      const keys = [...text.slice(0, n)].map((key, i) => ({ t: i + 1, key }));
      const input = withTrace(asInput(scriptedFast), keys);
      const flags = codes(input);
      if (n < DEFAULT_THRESHOLDS.MIN_WINDOW_KEYS) expect(flags).not.toContain("wpm-cap");
      expect(flags).not.toContain("regular-rhythm");
    }
    const fifty = withTrace(
      asInput(scriptedFast),
      [...text.slice(0, 50)].map((key, i) => ({ t: (i + 1) * 100, key })),
    );
    expect(codes(fifty)).toEqual(["regular-rhythm"]);
  });

  it("an empty trace yields nothing", () => {
    const input = withTrace(asInput(human1), []);
    expect(analyseTrace(input)).toEqual([]);
  });
});
