import { describe, expect, it } from "vitest";
import { applyKeystroke } from "../reducers/apply";
import { initialState, type PlayerState } from "../reducers/state";
import { mulberry32 } from "../testing/rng";
import { charsOf } from "../text/chars";
import { normalizeTypeable } from "../text/normalize";
import { wordCount } from "../text/word-count";
import type { EngineSettings } from "../types";
import { nextBotKeystroke } from "./next";
import { botProfile } from "./profile";
import { BOT_LEVELS, type BotContext } from "./types";

// 50 words, accents and punctuation included (no real data).
const FIXTURE = normalizeTypeable(
  "Le commis range les dossiers du bureau avant l'aube. Chaque formulaire porte un tampon, " +
    "une date et une signature lisible. Le directeur attend le rapport complet sur son bureau; " +
    "personne ne quitte la salle avant la fin du quart. Les machines à écrire claquent, " +
    "le café refroidit, la pile baisse.",
);

const MODES: EngineSettings[] = [
  { errorMode: "continue", backspace: true },
  { errorMode: "continue", backspace: false },
  { errorMode: "block", backspace: true },
  { errorMode: "block", backspace: false },
];

function ctx(state: PlayerState, settings: EngineSettings, elapsedMs = 0): BotContext {
  return { chars: charsOf(FIXTURE), state, settings, elapsedMs };
}

describe("nextBotKeystroke (stub, #729)", () => {
  it("the fixture has 50 words", () => {
    expect(wordCount(FIXTURE)).toBe(50);
  });

  it.each(BOT_LEVELS)("%s: next expected character at the level's mean delay", (level) => {
    const profile = botProfile(level);
    const settings = MODES[0] as EngineSettings;
    const action = nextBotKeystroke(profile, ctx(initialState(), settings), mulberry32(1));
    expect(action).toEqual({ key: FIXTURE[0], delayMs: 60000 / (profile.targetWpm * 5) });
    const mid = { ...initialState(), cursor: 7, typed: Array(7).fill(null) };
    expect(nextBotKeystroke(profile, ctx(mid, settings), mulberry32(1))?.key).toBe(FIXTURE[7]);
  });

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
    "%s finishes the 50-word fixture through applyKeystroke (%o)",
    (level, settings) => {
      const profile = botProfile(level);
      const rng = mulberry32(7);
      let state = initialState();
      let t = 0;
      let keys = 0;
      for (;;) {
        const action = nextBotKeystroke(profile, ctx(state, settings, t), rng);
        if (!action) break;
        t += action.delayMs;
        state = applyKeystroke(state, { t, key: action.key }, FIXTURE, settings);
        keys += 1;
        expect(keys).toBeLessThanOrEqual(FIXTURE.length);
      }
      expect(state).toMatchObject({ status: "finished", errors: 0, correct: FIXTURE.length });
      expect(keys).toBe(FIXTURE.length);
    },
  );
});
