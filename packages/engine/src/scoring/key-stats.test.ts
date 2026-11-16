import { describe, expect, it } from "vitest";
import human1 from "../anticheat/fixtures/human-1.json";
import human2 from "../anticheat/fixtures/human-2.json";
import human3 from "../anticheat/fixtures/human-3.json";
import scriptedConstant from "../anticheat/fixtures/scripted-constant.json";
import scriptedFast from "../anticheat/fixtures/scripted-fast.json";
import scriptedJittered from "../anticheat/fixtures/scripted-jittered.json";
import { KEY_PAUSE_MS, keyErrors, keyStats } from "../index";
import { applyKeystroke } from "../reducers/apply";
import { initialState } from "../reducers/state";
import type { EngineSettings, Keystroke } from "../types";

// Contract of #960: per expected character and per pair of consecutive expected characters, the
// presses, errors and typing time of one trace, from the same replay as `keyErrors` (#867).

type Fixture = { keystrokes: Keystroke[]; text: string; settings: EngineSettings };
const FIXTURES = {
  human1,
  human2,
  human3,
  scriptedConstant,
  scriptedFast,
  scriptedJittered,
} as Record<string, Fixture>;
const MODES: EngineSettings[] = [
  { errorMode: "continue", backspace: true },
  { errorMode: "continue", backspace: false },
  { errorMode: "block", backspace: true },
  { errorMode: "block", backspace: false },
];
const CONTINUE = MODES[0]!;
const BLOCK = MODES[2]!;

const keys = (s: string, every = 100): Keystroke[] =>
  [...s].map((key, i) => ({ t: (i + 1) * every, key: key === "⌫" ? "Backspace" : key }));
const at = (pairs: [string, number][]): Keystroke[] =>
  pairs.map(([key, t]) => ({ t, key: key === "⌫" ? "Backspace" : key }));
type Counts = { attempts: number; errors: number; timedHits: number; totalMs: number };
const counts = ({ attempts, errors, timedHits, totalMs }: Counts): Counts => ({
  attempts,
  errors,
  timedHits,
  totalMs,
});
const byChar = (r: ReturnType<typeof keyStats>) =>
  Object.fromEntries(r.chars.map((c) => [c.char, counts(c)]));
const byPair = (r: ReturnType<typeof keyStats>) =>
  Object.fromEntries(r.pairs.map((p) => [p.pair, counts(p)]));
const total = (list: readonly Counts[]): Counts =>
  list.reduce(
    (s, c) => ({
      attempts: s.attempts + c.attempts,
      errors: s.errors + c.errors,
      timedHits: s.timedHits + c.timedHits,
      totalMs: s.totalMs + c.totalMs,
    }),
    { attempts: 0, errors: 0, timedHits: 0, totalMs: 0 },
  );

describe("keyStats C1: chars agree with keyErrors", () => {
  for (const [name, f] of Object.entries(FIXTURES)) {
    it.each(MODES)(`${name} (%o)`, (settings) => {
      const { chars } = keyStats({ ...f, settings });
      expect(chars.map(({ char, attempts, errors }) => ({ char, attempts, errors }))).toEqual(
        keyErrors({ ...f, settings }),
      );
    });
  }

  it("is exported with its pause bound", () => {
    expect(KEY_PAUSE_MS).toBe(2000);
    expect(keyStats({ keystrokes: [], text: "abc", settings: CONTINUE })).toEqual({
      chars: [],
      pairs: [],
    });
  });
});

describe("keyStats C2: timing", () => {
  it("the first accepted keystroke is never timed; the next one is, by its gap", () => {
    const r = keyStats({ keystrokes: keys("ab"), text: "ab", settings: CONTINUE });
    expect(byChar(r)).toEqual({
      a: { attempts: 1, errors: 0, timedHits: 0, totalMs: 0 },
      b: { attempts: 1, errors: 0, timedHits: 1, totalMs: 100 },
    });
  });

  it("a gap of exactly KEY_PAUSE_MS counts, one more millisecond does not", () => {
    const counted = keyStats({
      keystrokes: at([
        ["a", 1000],
        ["b", 1000 + KEY_PAUSE_MS],
      ]),
      text: "ab",
      settings: CONTINUE,
    });
    expect(byChar(counted).b).toEqual({ attempts: 1, errors: 0, timedHits: 1, totalMs: 2000 });
    const paused = keyStats({
      keystrokes: at([
        ["a", 1000],
        ["b", 1000 + KEY_PAUSE_MS + 1],
      ]),
      text: "ab",
      settings: CONTINUE,
    });
    expect(byChar(paused).b).toEqual({ attempts: 1, errors: 0, timedHits: 0, totalMs: 0 });
  });

  it("a rejected keystroke is not the previous one", () => {
    const r = keyStats({
      keystrokes: at([
        ["a", 500],
        ["x", 100], // older than the last key: rejected
        ["b", 700],
      ]),
      text: "ab",
      settings: CONTINUE,
    });
    expect(byChar(r).b).toEqual({ attempts: 1, errors: 0, timedHits: 1, totalMs: 200 });
  });

  it("Block: an error is never timed, its correction is (from the wrong press)", () => {
    const r = keyStats({
      keystrokes: at([
        ["x", 100],
        ["a", 250],
        ["b", 400],
      ]),
      text: "ab",
      settings: BLOCK,
    });
    expect(byChar(r)).toEqual({
      a: { attempts: 2, errors: 1, timedHits: 1, totalMs: 150 },
      b: { attempts: 1, errors: 0, timedHits: 1, totalMs: 150 },
    });
  });

  it("Continue: a wrong press, its backspace, then the right key timed from the backspace", () => {
    const r = keyStats({
      keystrokes: at([
        ["a", 100],
        ["x", 200],
        ["⌫", 400],
        ["b", 450],
      ]),
      text: "abc", // the last character finishes the text: nothing to undo after it
      settings: CONTINUE,
    });
    expect(byChar(r)).toEqual({
      a: { attempts: 1, errors: 0, timedHits: 0, totalMs: 0 },
      b: { attempts: 2, errors: 0, timedHits: 1, totalMs: 50 },
    });
    expect(byPair(r)).toEqual({ ab: { attempts: 2, errors: 0, timedHits: 1, totalMs: 50 } });
  });

  it("a wrong press that stays is an error and never timed (Continue, no backspace)", () => {
    const r = keyStats({
      keystrokes: keys("ax"),
      text: "ab",
      settings: { errorMode: "continue", backspace: false },
    });
    expect(byChar(r).b).toEqual({ attempts: 1, errors: 1, timedHits: 0, totalMs: 0 });
  });
});

describe("keyStats C3: pairs", () => {
  it("one entry per ordered pair that received a press, in the order first asked for", () => {
    const r = keyStats({ keystrokes: keys("bab a"), text: "bab a", settings: CONTINUE });
    expect(r.pairs.map((p) => p.pair)).toEqual(["ba", "ab", "b ", " a"]);
    expect(byPair(r)).toEqual({
      ba: { attempts: 1, errors: 0, timedHits: 1, totalMs: 100 },
      ab: { attempts: 1, errors: 0, timedHits: 1, totalMs: 100 },
      "b ": { attempts: 1, errors: 0, timedHits: 1, totalMs: 100 },
      " a": { attempts: 1, errors: 0, timedHits: 1, totalMs: 100 },
    });
  });

  it("repeats add up on the same pair; a pair never pressed is absent", () => {
    const r = keyStats({ keystrokes: keys("aba"), text: "abab", settings: CONTINUE });
    expect(byPair(r)).toEqual({
      ab: { attempts: 1, errors: 0, timedHits: 1, totalMs: 100 },
      ba: { attempts: 1, errors: 0, timedHits: 1, totalMs: 100 },
    });
    const full = keyStats({ keystrokes: keys("abab"), text: "abab", settings: CONTINUE });
    expect(byPair(full).ab).toEqual({ attempts: 2, errors: 0, timedHits: 2, totalMs: 200 });
  });

  it("errors are charged to the pair, and a Continue backspace takes them back from it", () => {
    const block = keyStats({ keystrokes: keys("aqqb"), text: "ab", settings: BLOCK });
    expect(byPair(block)).toEqual({ ab: { attempts: 3, errors: 2, timedHits: 1, totalMs: 100 } });
    const kept = keyStats({
      keystrokes: keys("ax"),
      text: "ab",
      settings: { errorMode: "continue", backspace: false },
    });
    expect(byPair(kept).ab!.errors).toBe(1);
    const undone = keyStats({ keystrokes: keys("ax⌫"), text: "abc", settings: CONTINUE });
    expect(byPair(undone).ab).toEqual({ attempts: 1, errors: 0, timedHits: 0, totalMs: 0 });
  });
});

describe("keyStats C4: chars add up to pairs plus the presses at index 0", () => {
  // Test-side oracle: the presses made while index 0 was expected, replayed by hand.
  const index0 = (f: Fixture, settings: EngineSettings): Counts => {
    const c = { attempts: 0, errors: 0, timedHits: 0, totalMs: 0 };
    let state = initialState();
    let prevT: number | null = null;
    for (const k of f.keystrokes) {
      const next = applyKeystroke(state, k, f.text, settings);
      if (next === state) continue;
      if (k.key === "Backspace") {
        if (next.cursor === 0 && state.cursor === 1 && state.typed[0] != null) c.errors -= 1;
      } else if (state.cursor === 0) {
        c.attempts += 1;
        const wrong = next.errors > state.errors;
        if (wrong) c.errors += 1;
        if (!wrong && prevT !== null && k.t - prevT <= KEY_PAUSE_MS) {
          c.timedHits += 1;
          c.totalMs += k.t - prevT;
        }
      }
      prevT = k.t;
      state = next;
    }
    return c;
  };

  for (const name of ["human1", "human2", "human3"]) {
    it.each(MODES)(`${name} (%o)`, (settings) => {
      const f = FIXTURES[name]!;
      const { chars, pairs } = keyStats({ ...f, settings });
      const head = index0(f, settings);
      const sumPairs = total(pairs);
      expect(total(chars)).toEqual({
        attempts: sumPairs.attempts + head.attempts,
        errors: sumPairs.errors + head.errors,
        timedHits: sumPairs.timedHits + head.timedHits,
        totalMs: sumPairs.totalMs + head.totalMs,
      });
      expect(head.attempts).toBeGreaterThan(0);
      expect(sumPairs.timedHits).toBeGreaterThan(0); // not trivially zero
    });
  }

  it("exactly: index 0 is the only position outside every pair", () => {
    // text "xab": index 0 is the only "x"; its presses are exactly the difference
    const trace = keys("qx⌫⌫xaqb", 150);
    for (const settings of MODES) {
      const { chars, pairs } = keyStats({ keystrokes: trace, text: "xab", settings });
      const x = chars.find((c) => c.char === "x");
      const diff = (k: keyof Counts) => total(chars)[k] - total(pairs)[k];
      for (const k of ["attempts", "errors", "timedHits", "totalMs"] as const) {
        expect(diff(k)).toBe(x ? x[k] : 0);
      }
    }
  });
});

describe("keyStats C5: pure", () => {
  it("same input, same tallies", () => {
    const f = FIXTURES.human2!;
    expect(keyStats(f)).toEqual(keyStats(f));
  });
});
