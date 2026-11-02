import { describe, expect, it } from "vitest";
import { initialState, type PlayerState } from "../reducers/state";
import { mulberry32 } from "../testing/rng";
import { charsOf } from "../text/chars";
import { normalizeTypeable } from "../text/normalize";
import { wordCount } from "../text/word-count";
import { traceCapOf } from "../trace/cap";
import type { EngineSettings } from "../types";
import { nextBotKeystroke } from "./next";
import { botProfile } from "./profile";
import { drive } from "./testing/drive";
import { FIXTURE_FR } from "./testing/fixture";
import { BOT_LEVELS, type BotContext } from "./types";

// 50 words, accents and punctuation included (no real data).
const FIXTURE = normalizeTypeable(
  "Le commis range les dossiers du bureau avant l'aube. Chaque formulaire porte un tampon, " +
    "une date et une signature lisible. Le directeur attend le rapport complet sur son bureau; " +
    "personne ne quitte la salle avant la fin du quart. Les machines à écrire claquent, " +
    "le café refroidit, la pile baisse.",
);

const MODES: readonly EngineSettings[] = [
  { errorMode: "continue", backspace: true },
  { errorMode: "continue", backspace: false },
  { errorMode: "block", backspace: true },
  { errorMode: "block", backspace: false },
];

function ctx(state: PlayerState, settings: EngineSettings, elapsedMs = 0): BotContext {
  return { chars: charsOf(FIXTURE), state, settings, elapsedMs };
}

describe("nextBotKeystroke (#729 interface, #361 model)", () => {
  it("the fixture has 50 words", () => {
    expect(wordCount(FIXTURE)).toBe(50);
  });

  it.each(BOT_LEVELS)(
    "%s: a key for the cursor's position, after a positive float delay",
    (level) => {
      const profile = { ...botProfile(level), errorRate: 0 };
      const settings = MODES[0] as EngineSettings;
      const action = nextBotKeystroke(profile, ctx(initialState(), settings), mulberry32(1));
      expect(action?.key).toBe(FIXTURE[0]);
      expect(action!.delayMs).toBeGreaterThan(0);
      expect(Number.isInteger(action!.delayMs)).toBe(false);
      const mid = { ...initialState(), cursor: 7, typed: Array(7).fill(null) };
      expect(nextBotKeystroke(profile, ctx(mid, settings), mulberry32(1))?.key).toBe(FIXTURE[7]);
    },
  );

  it("returns null at the end of the text and once not typing", () => {
    const profile = botProfile("clerk");
    const settings = MODES[0] as EngineSettings;
    const n = charsOf(FIXTURE).length;
    const atEnd = { ...initialState(), cursor: n, typed: Array(n).fill(null) };
    expect(nextBotKeystroke(profile, ctx(atEnd, settings), mulberry32(1))).toBeNull();
    for (const status of ["finished", "abandoned", "asleep", "line-cut", "expired"] as const) {
      const s = { ...initialState(), status };
      expect(nextBotKeystroke(profile, ctx(s, settings), mulberry32(1))).toBeNull();
    }
    const empty: BotContext = { chars: [], state: initialState(), settings, elapsedMs: 0 };
    expect(nextBotKeystroke(profile, empty, mulberry32(1))).toBeNull();
  });

  it.each(MODES.flatMap((m) => BOT_LEVELS.map((level) => [level, m] as const)))(
    "%s finishes the 50-word fixture through applyKeystroke, then gets null (%o)",
    (level, settings) => {
      const run = drive(botProfile(level), FIXTURE, settings, 7);
      expect(run.state.status).toBe("finished");
      expect(run.keys.length).toBeLessThan(traceCapOf(FIXTURE.length));
      const after = nextBotKeystroke(botProfile(level), ctx(run.state, settings), mulberry32(7));
      expect(after).toBeNull();
    },
  );
});

describe("determinism (C6)", () => {
  it.each(MODES.flatMap((m) => BOT_LEVELS.map((level) => [level, m] as const)))(
    "%s: same profile, text, settings and seed, same keystrokes (%o)",
    (level, settings) => {
      for (const seed of [1, 17, 50]) {
        const a = drive(botProfile(level), FIXTURE_FR, settings, seed, "fr");
        const b = drive(botProfile(level), FIXTURE_FR, settings, seed, "fr");
        expect(b.trace).toEqual(a.trace);
        expect(b.state).toEqual(a.state);
      }
      const other = drive(botProfile(level), FIXTURE_FR, settings, 2, "fr");
      expect(other.trace).not.toEqual(
        drive(botProfile(level), FIXTURE_FR, settings, 1, "fr").trace,
      );
    },
  );

  it("never mutates its context", () => {
    const state = initialState();
    const c = Object.freeze({ ...ctx(state, MODES[0] as EngineSettings) });
    const before = JSON.stringify(c);
    nextBotKeystroke(botProfile("major"), c, mulberry32(5));
    expect(JSON.stringify(c)).toBe(before);
  });
});
