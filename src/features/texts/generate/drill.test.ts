import { describe, expect, it } from "vitest";
import { mulberry32, wordCount } from "@fifth-copy/engine";
import { fileProvider } from "../corpus/files";
import { generateRaceText } from "./generate";
import { STRATEGIES } from "./strategies";
import { drillStrategy, isSpecial, SPECIAL_SHARE } from "./drill";
import { LANGUAGES, PRESETS, raceSettings, SEEDS, share, textWords } from "./test-helpers";
import { coreOf, hasAccent, PUNCTUATION, SYMBOLS } from "./tokens";

// Contract of #354 C1: the special-characters drill.

const ALLOWED = new Set([...SYMBOLS, ...PUNCTUATION, "-"]);

describe("special-characters drill (C1)", () => {
  it("is the third entry of STRATEGIES", () => {
    expect(STRATEGIES["special-characters"]).toBe(drillStrategy);
    expect(SPECIAL_SHARE).toBe(0.6);
  });

  for (const language of LANGUAGES) {
    for (const symbols of [false, true]) {
      it(`${language}, symbols ${symbols ? "on" : "off"}: >= 60 % special words, exact count`, () => {
        for (const difficulty of PRESETS) {
          for (const count of [10, 37, 500]) {
            for (const seed of SEEDS) {
              const s = raceSettings(language, "special-characters", {
                difficulty,
                wordCount: count,
                includeSymbols: symbols,
              });
              const { content } = generateRaceText(s, { rng: mulberry32(seed) });
              expect(wordCount(content)).toBe(count);
              const words = content.split(" ");
              if (share(words, isSpecial) < 0.6)
                expect({ difficulty, count, seed, content }).toBeNull();
            }
          }
        }
      });
    }

    it(`${language}: specials come from the frequency list and the symbol set`, () => {
      const list = new Set(fileProvider.words(language));
      for (const seed of SEEDS) {
        const words = textWords(
          raceSettings(language, "special-characters", { wordCount: 100, includeSymbols: true }),
          seed,
        );
        for (const word of words) {
          expect(list.has(coreOf(word)), word).toBe(true);
          for (const c of word.replace(coreOf(word), ""))
            expect(ALLOWED.has(c), `${c} in ${word}`).toBe(true);
        }
      }
    });
  }

  it("French drills carry accented words, English ones never", () => {
    const fr = SEEDS.flatMap((seed) =>
      textWords(raceSettings("fr", "special-characters", { wordCount: 100 }), seed),
    );
    const en = SEEDS.flatMap((seed) =>
      textWords(raceSettings("en", "special-characters", { wordCount: 100 }), seed),
    );
    expect(share(fr, hasAccent)).toBeGreaterThan(0.2);
    expect(share(en, hasAccent)).toBe(0);
  });
});
