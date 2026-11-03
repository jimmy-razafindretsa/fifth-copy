import { describe, expect, it } from "vitest";
import { mulberry32, normalizeTypeable } from "@fifth-copy/engine";
import type { RaceLanguage } from "@fifth-copy/protocol";
import { fileProvider } from "../corpus/files";
import { generateRaceText } from "./generate";
import { sentencePassages, topBand } from "./strategies";
import { LANGUAGES, PRESETS, raceSettings, SEEDS, share, textWords } from "./test-helpers";
import { coreOf } from "./tokens";
import { LETTER_SHARE, letterDensity } from "./transforms/practice-letters";

// Contract of #354 C2: practice letters.

const LETTER_SETS: Record<RaceLanguage, string[][]> = {
  fr: [["é"], ["s", "t"], ["q", "u", "v"]],
  en: [["k"], ["s", "t"], ["w", "h", "y"]],
};

const holds = (letter: string) => (w: string) => coreOf(w).toLowerCase().includes(letter);

describe("practice letters in words mode and the drill (C2)", () => {
  it("asks 40 % of the words", () => expect(LETTER_SHARE).toBe(0.4));

  for (const language of LANGUAGES) {
    for (const textType of ["words", "special-characters"] as const) {
      for (const letters of LETTER_SETS[language]) {
        it(`${language} ${textType} [${letters.join(" ")}]: each letter in >= 40 % of words`, () => {
          for (const difficulty of PRESETS) {
            for (const wordCount of [10, 100, 500]) {
              for (const seed of SEEDS.slice(0, 10)) {
                const s = raceSettings(language, textType, {
                  difficulty,
                  wordCount,
                  practiceLetters: letters,
                });
                const words = textWords(s, seed);
                expect(words).toHaveLength(wordCount);
                for (const letter of letters)
                  if (share(words, holds(letter)) < LETTER_SHARE)
                    expect({ letter, difficulty, wordCount, seed, words }).toBeNull();
              }
            }
          }
        });
      }
    }
  }

  it("upper-case letters count as their lower-case form", () => {
    const words = textWords(raceSettings("en", "words", { practiceLetters: ["K"] }), 1);
    expect(share(words, holds("k"))).toBeGreaterThanOrEqual(LETTER_SHARE);
  });
});

describe("practice letters in sentences mode (C2)", () => {
  for (const language of LANGUAGES) {
    const letters = LETTER_SETS[language][1]!;
    const passages = fileProvider.sentences(language);

    it(`${language}: passages are ranked by letter density and the top band is drawn from`, () => {
      const s = raceSettings(language, "sentences", { wordCount: 12, practiceLetters: letters });
      const band = sentencePassages(passages, s);
      const withoutLetters = sentencePassages(passages, { ...s, practiceLetters: [] });
      expect(band.length).toBeLessThan(withoutLetters.length);
      const density = (t: string) => letterDensity(t, letters);
      const floor = Math.min(...band.map((p) => density(p.text)));
      for (const p of withoutLetters)
        if (!band.includes(p)) expect(density(p.text)).toBeLessThanOrEqual(floor);
      for (const seed of SEEDS.slice(0, 10)) {
        const { content } = generateRaceText(s, { rng: mulberry32(seed) });
        expect(
          band.some((p) => normalizeTypeable(p.text).startsWith(content)),
          content,
        ).toBe(true);
      }
    });
  }

  it("topBand keeps the best third, at least 5", () => {
    const ps = Array.from({ length: 30 }, (_, i) => ({ text: "x".repeat(i + 1) }));
    expect(topBand(ps, (t) => t.length).map((p) => p.text.length)).toEqual(
      Array.from({ length: 10 }, (_, i) => 30 - i),
    );
    expect(topBand(ps.slice(0, 9), (t) => t.length)).toHaveLength(5);
    expect(topBand(ps.slice(0, 4), (t) => t.length)).toHaveLength(4);
  });
});
