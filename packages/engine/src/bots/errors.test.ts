import { describe, expect, it } from "vitest";
import { analyseTrace } from "../anticheat/analyse";
import { BACKSPACE } from "../reducers/apply";
import { mulberry32 } from "../testing/rng";
import { wrongKey } from "./errors";
import { botProfile } from "./profile";
import { drive, MODES, SEEDS } from "./testing/drive";
import { FIXTURE_FR } from "./testing/fixture";
import { BOT_LEVELS } from "./types";

// #361 C4: error rate per level within one point of the profile's; corrections through
// `applyKeystroke` per the race's error mode; the bot always reaches `finished`.
const TEXT = FIXTURE_FR;
const RATES = { recruit: 0.06, clerk: 0.04, officer: 0.03, commissar: 0.02, major: 0.01 } as const;

const CASES = MODES.flatMap((settings) => BOT_LEVELS.map((level) => [level, settings] as const));

describe("errors and corrections (C4)", () => {
  it.each(BOT_LEVELS)("%s: the profile's error rate", (level) => {
    expect(botProfile(level).errorRate).toBe(RATES[level]);
  });

  it.each(CASES)(
    "%s %o: rate within one point, corrected per mode, finished",
    (level, settings) => {
      let wrong = 0;
      for (const seed of SEEDS) {
        const run = drive(botProfile(level), TEXT, settings, seed, "fr");
        const { keys, state } = run;
        expect(state.status, `seed ${seed}`).toBe("finished");
        const misses = keys.filter((k) => k.wrong).length;
        wrong += misses;
        const backspaces = keys.filter((k) => k.key === BACKSPACE).length;
        if (settings.errorMode === "block") {
          // Every wrong key is refused by the reducer: the next key is the same position again.
          expect(backspaces).toBe(0);
          keys.forEach((k, i) => {
            if (k.wrong) expect(keys[i + 1]?.cursor).toBe(k.cursor);
          });
          expect(state).toMatchObject({ correct: TEXT.length, errors: misses });
        } else if (settings.backspace) {
          // Each wrong key is backspaced at once (unless it ended the text), then the position retyped.
          keys.forEach((k, i) => {
            if (!k.wrong || k.cursor === TEXT.length - 1) return;
            expect(keys[i + 1]?.key).toBe(BACKSPACE);
            expect(keys[i + 2]?.cursor).toBe(k.cursor);
          });
          const last = keys.at(-1)!;
          expect(backspaces).toBe(misses - (last.wrong ? 1 : 0));
          expect(state.errors).toBe(last.wrong ? 1 : 0);
        } else {
          // No backspace allowed: the bot types on, one key per character.
          expect(backspaces).toBe(0);
          expect(keys).toHaveLength(TEXT.length);
          expect(state.errors).toBe(misses);
        }
        const { cursor, correct, errors } = state;
        const flags = analyseTrace({
          keystrokes: run.trace,
          text: TEXT,
          settings,
          recorded: { cursor, correct, errors },
          timingAnomalies: 0,
        });
        expect(flags, `seed ${seed}`).toEqual([]);
      }
      const rate = wrong / (TEXT.length * SEEDS.length);
      expect(Math.abs(rate - RATES[level])).toBeLessThanOrEqual(0.01);
    },
  );

  it("a wrong key is never the expected one and keeps its case", () => {
    const rng = mulberry32(3);
    for (const expected of [..."aqzmAQZM é,.«»€0 "]) {
      for (let i = 0; i < 50; i++) {
        const key = wrongKey(expected, rng);
        expect(key).not.toBe(expected);
        expect(key).toMatch(/^[a-zA-Z]$/);
        if (/[A-Z]/.test(expected)) expect(key).toMatch(/[A-Z]/);
      }
    }
  });
});
