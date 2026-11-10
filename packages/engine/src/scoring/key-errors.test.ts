import { describe, expect, it } from "vitest";
import human1 from "../anticheat/fixtures/human-1.json";
import human2 from "../anticheat/fixtures/human-2.json";
import human3 from "../anticheat/fixtures/human-3.json";
import scriptedConstant from "../anticheat/fixtures/scripted-constant.json";
import scriptedFast from "../anticheat/fixtures/scripted-fast.json";
import scriptedJittered from "../anticheat/fixtures/scripted-jittered.json";
import { replayTrace } from "../anticheat/analyse";
import type { EngineSettings, Keystroke } from "../types";
import { keyErrors } from "./key-errors";

// Contract of #867 C1: one pure function replays a trace on a text and returns, per expected character,
// the attempts and the errors; its error total equals the replayed state's `errors` for the engine
// fixtures (in every error mode, backspace allowed or not).

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
const sum = (tallies: { errors: number }[]) => tallies.reduce((n, t) => n + t.errors, 0);
const byChar = (tallies: ReturnType<typeof keyErrors>) =>
  Object.fromEntries(tallies.map((t) => [t.char, { attempts: t.attempts, errors: t.errors }]));

describe("keyErrors (#867 C1)", () => {
  for (const [name, f] of Object.entries(FIXTURES)) {
    it.each(MODES)(`${name}: errors add up to the replay's (%o)`, (settings) => {
      const tallies = keyErrors({ ...f, settings });
      const state = replayTrace(f.keystrokes, f.text, settings);
      expect(sum(tallies)).toBe(state.errors);
      for (const t of tallies) {
        expect(f.text).toContain(t.char);
        expect(t.errors).toBeGreaterThanOrEqual(0);
        expect(t.errors).toBeLessThanOrEqual(t.attempts);
      }
    });
  }

  it("with no backspace the human fixtures' misses stay, so the totals are not trivially zero", () => {
    const settings: EngineSettings = { errorMode: "continue", backspace: false };
    for (const name of ["human1", "human2", "human3"]) {
      expect(sum(keyErrors({ ...FIXTURES[name]!, settings }))).toBeGreaterThan(0);
    }
  });

  it("charges each press to the character expected under the cursor (Continue)", () => {
    // text "aba": typed "xbx" -> a missed twice, b once right
    const tallies = keyErrors({ keystrokes: keys("xbx"), text: "aba", settings: CONTINUE });
    expect(byChar(tallies)).toEqual({ a: { attempts: 2, errors: 2 }, b: { attempts: 1, errors: 0 } });
    expect(tallies.map((t) => t.char)).toEqual(["a", "b"]); // first asked for first
  });

  it("Block mode: every wrong press on the stuck character counts", () => {
    const tallies = keyErrors({ keystrokes: keys("qqqa b"), text: "a b", settings: BLOCK });
    expect(byChar(tallies)).toEqual({
      a: { attempts: 4, errors: 3 },
      " ": { attempts: 1, errors: 0 },
      b: { attempts: 1, errors: 0 },
    });
    expect(sum(tallies)).toBe(replayTrace(keys("qqqa b"), "a b", BLOCK).errors);
  });

  it("a backspace in Continue mode takes the undone error back from its character", () => {
    const trace = keys("x⌫ab");
    const tallies = keyErrors({ keystrokes: trace, text: "ab", settings: CONTINUE });
    expect(byChar(tallies)).toEqual({ a: { attempts: 2, errors: 0 }, b: { attempts: 1, errors: 0 } });
    // backspace off: the press is only counted, the x stays and the a lands on the b
    const kept = keyErrors({
      keystrokes: trace,
      text: "ab",
      settings: { errorMode: "continue", backspace: false },
    });
    expect(byChar(kept)).toEqual({ a: { attempts: 1, errors: 1 }, b: { attempts: 1, errors: 1 } });
    // undoing a correct character takes nothing back
    const right = keyErrors({ keystrokes: keys("a⌫ab"), text: "ab", settings: CONTINUE });
    expect(sum(right)).toBe(0);
    expect(byChar(right).a).toEqual({ attempts: 2, errors: 0 });
  });

  it("rejected keystrokes count nothing; an empty trace returns no tally", () => {
    expect(keyErrors({ keystrokes: [], text: "abc", settings: CONTINUE })).toEqual([]);
    const late = [
      { t: 500, key: "a" },
      { t: 100, key: "x" }, // older than the last key: rejected
    ];
    expect(byChar(keyErrors({ keystrokes: late, text: "ab", settings: CONTINUE }))).toEqual({
      a: { attempts: 1, errors: 0 },
    });
    // past the end of the text
    expect(sum(keyErrors({ keystrokes: keys("abzz"), text: "ab", settings: CONTINUE }))).toBe(0);
  });

  it("is pure: same input, same tallies", () => {
    const f = FIXTURES.human2!;
    expect(keyErrors(f)).toEqual(keyErrors(f));
  });
});
