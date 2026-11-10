import { describe, expect, it } from "vitest";
import human1 from "../anticheat/fixtures/human-1.json";
import human2 from "../anticheat/fixtures/human-2.json";
import human3 from "../anticheat/fixtures/human-3.json";
import scriptedConstant from "../anticheat/fixtures/scripted-constant.json";
import { replayTrace } from "../anticheat/analyse";
import { cleanAndAdjustedWpm, elapsedFor } from "./scoring";
import { MAX_SERIES_POINTS, wpmSeries } from "./series";
import { EMPTY_OVERLAY, baseLengthOf, effectiveText } from "../text/overlay";
import type { EngineSettings, Keystroke } from "../types";

// Contract of #865 C1: one pure function replays a trace on a text and returns the clean WPM at the end
// of each time bucket with `wpm()`'s formula; its last point is the scored clean WPM.

type Fixture = { keystrokes: Keystroke[]; text: string; settings: EngineSettings };
const FINISHED = { human1, human2, human3, scriptedConstant } as Record<string, Fixture>;
const CONTINUE: EngineSettings = { errorMode: "continue", backspace: true };

describe("wpmSeries (#865 C1)", () => {
  it.each(Object.entries(FINISHED))("%s: the last point is the scored clean WPM", (_n, f) => {
    const state = replayTrace(f.keystrokes, f.text, f.settings);
    expect(state.status).toBe("finished");
    const elapsed = elapsedFor(state, state.lastT);
    const { clean } = cleanAndAdjustedWpm(state, f.text, EMPTY_OVERLAY, elapsed);
    const series = wpmSeries(f);
    expect(series.length).toBeGreaterThanOrEqual(2);
    expect(series.length).toBeLessThanOrEqual(MAX_SERIES_POINTS);
    expect(series.at(-1)!.t).toBe(elapsed);
    expect(Math.abs(series.at(-1)!.wpm - clean)).toBeLessThanOrEqual(0.5);
    // time moves forward, every figure is a WPM
    for (let i = 1; i < series.length; i++) expect(series[i]!.t).toBeGreaterThan(series[i - 1]!.t);
    for (const p of series) expect(p.wpm).toBeGreaterThanOrEqual(0);
  });

  it("an empty trace returns no point", () => {
    expect(wpmSeries({ keystrokes: [], text: "abc", settings: CONTINUE })).toEqual([]);
    expect(wpmSeries({ keystrokes: [], text: "abc", settings: CONTINUE, endMs: 5_000 })).toEqual(
      [],
    );
  });

  it("never more than maxPoints, never a bucket under a second", () => {
    const long = wpmSeries({ ...human1, endMs: 600_000 } as Fixture & { endMs: number });
    expect(long).toHaveLength(MAX_SERIES_POINTS);
    const short = wpmSeries({
      keystrokes: [
        { t: 400, key: "a" },
        { t: 2_500, key: "b" },
      ],
      text: "ab",
      settings: CONTINUE,
    });
    expect(short.map((p) => p.t)).toEqual([1_250, 2_500]);
    // `wpm()`: 1 correct char over 1.25 s, then 2 over 2.5 s
    for (const p of short) expect(p.wpm).toBeCloseTo(9.6, 9);
  });

  it("counts only base characters (clean WPM, ADR 0016), as the scored clean figure", () => {
    const base = "aa bb";
    const overlay = { extra: ["cc"], removed: [] };
    const text = effectiveText(base, overlay);
    const keystrokes = Array.from(text, (key, i) => ({ t: (i + 1) * 500, key }));
    const series = wpmSeries({
      keystrokes,
      text,
      settings: CONTINUE,
      baseLength: baseLengthOf(base, overlay),
    });
    const state = replayTrace(keystrokes, text, CONTINUE);
    const { clean, adjusted } = cleanAndAdjustedWpm(state, base, overlay, state.finishedAt!);
    expect(clean).toBeLessThan(adjusted);
    expect(series.at(-1)!.wpm).toBeCloseTo(clean, 9);
  });

  it("does not touch its input (pure)", () => {
    const f = structuredClone(human2) as Fixture;
    const before = JSON.stringify(f);
    expect(wpmSeries(f)).toEqual(wpmSeries(f));
    expect(JSON.stringify(f)).toBe(before);
  });
});
