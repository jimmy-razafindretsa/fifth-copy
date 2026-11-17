import { describe, expect, it } from "vitest";
import type { EngineSettings, Keystroke } from "@fifth-copy/engine";
import { traceIncrements } from "./trace-increments";

// #314 C2, C3: what one trace adds to the daily rows, pure (the extension point of the rollup).

const settings: EngineSettings = { errorMode: "continue", backspace: true };

/** `keys` typed one every `gap` ms from t = gap (the first press is never timed). */
const typed = (keys: string[], gap = 100): Keystroke[] =>
  keys.map((key, i) => ({ t: gap * (i + 1), key }));

describe("traceIncrements", () => {
  it("C2 lower-cases the expected character: capital and small e land on one row", () => {
    const text = "Le le";
    const { chars } = traceIncrements({ keystrokes: typed([...text]), text, settings });
    const by = new Map(chars.map((c) => [c.char, c]));
    expect([...by.keys()].sort()).toEqual([" ", "e", "l"]);
    // "L" is the first press (untimed), "l" is timed
    expect(by.get("l")).toEqual({ char: "l", hits: 2, errors: 0, timedHits: 1, totalMs: 100 });
    expect(by.get("e")).toEqual({ char: "e", hits: 2, errors: 0, timedHits: 2, totalMs: 200 });
    expect(by.get(" ")).toEqual({ char: " ", hits: 1, errors: 0, timedHits: 1, totalMs: 100 });
  });

  it("C2 keeps every expected character: letters, digits, punctuation, the space", () => {
    const text = "A1, é!";
    const { chars } = traceIncrements({ keystrokes: typed([...text]), text, settings });
    expect(chars.map((c) => c.char).sort()).toEqual([" ", "!", ",", "1", "a", "é"].sort());
    expect(chars.every((c) => c.hits === 1)).toBe(true);
  });

  it("C2 charges a wrong press to the expected character, as the engine counts it", () => {
    const text = "ab";
    // "x" while "a" is expected (continue mode: the cursor moves on), then "b"
    const { chars } = traceIncrements({ keystrokes: typed(["x", "b"]), text, settings });
    const by = new Map(chars.map((c) => [c.char, c]));
    expect(by.get("a")).toMatchObject({ hits: 1, errors: 1, timedHits: 0 });
    expect(by.get("b")).toMatchObject({ hits: 1, errors: 0, timedHits: 1, totalMs: 100 });
  });

  it("C3 keeps only pairs of two letters, lower-cased and merged", () => {
    const text = "Le le, 2a éÉ";
    const { pairs } = traceIncrements({ keystrokes: typed([...text]), text, settings });
    const by = new Map(pairs.map((p) => [p.pair, p]));
    expect([...by.keys()].sort()).toEqual(["le", "éé"].sort());
    // "Le" and "le" are one row
    expect(by.get("le")).toEqual({ pair: "le", hits: 2, errors: 0, timedHits: 2, totalMs: 200 });
  });

  it("an empty trace adds nothing", () => {
    expect(traceIncrements({ keystrokes: [], text: "le chat", settings })).toEqual({
      chars: [],
      pairs: [],
    });
  });
});
