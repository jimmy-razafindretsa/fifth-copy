import { describe, expect, it } from "vitest";
import { mulberry32, RARE_LETTERS } from "@fifth-copy/engine";
import { DEFAULT_RACE_SETTINGS, type Difficulty, type RaceLanguage } from "@fifth-copy/protocol";
import { generateRaceText } from "../index";
import { fileProvider } from "../corpus/files";
import {
  BAND_THRESHOLDS,
  bandOf,
  bandOfScore,
  MIN_BAND_PASSAGES,
  passageScore,
  passagesFor,
  PRESETS,
  recipeOf,
} from "./difficulty";
import type { SeedSentence } from "./types";

// Contract of #351 C5 (words mode) and C6 (sentences mode).

const LANGUAGES: RaceLanguage[] = ["fr", "en"];
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
const MARK = /[,.!?;:]$/;
const bare = (word: string) => word.replace(/[,.!?;:]+$/, "");
const letters = (word: string) => [...bare(word)].filter((c) => /\p{L}/u.test(c)).length;
const rare = (word: string, language: RaceLanguage) =>
  [...bare(word)].some((c) => RARE_LETTERS[language].has(c));

const wordsText = (language: RaceLanguage, difficulty: Difficulty, seed: number, count = 100) =>
  generateRaceText(
    { ...DEFAULT_RACE_SETTINGS, language, textType: "words", wordCount: count, difficulty },
    { rng: mulberry32(seed) },
  ).content.split(" ");

const share = (words: readonly string[], test: (w: string) => boolean) =>
  words.filter(test).length / words.length;

describe("words mode presets (C5)", () => {
  it("the presets are rows of the recipe table", () => {
    for (const level of ["easy", "normal", "hard"] as const)
      expect(recipeOf({ level })).toBe(PRESETS[level]);
  });

  for (const language of LANGUAGES) {
    const list = fileProvider.words(language);

    it(`${language} easy: top 1000, at most 5 letters, no rare letter, no punctuation`, () => {
      const top = new Set(list.slice(0, 1000));
      for (const seed of SEEDS)
        for (const word of wordsText(language, { level: "easy" }, seed)) {
          expect(top.has(word), word).toBe(true);
          expect(letters(word), word).toBeLessThanOrEqual(5);
          expect(rare(word, language), word).toBe(false);
        }
    });

    it(`${language} normal: top 3000, at most 9 letters`, () => {
      const top = new Set(list.slice(0, 3000));
      for (const seed of SEEDS)
        for (const word of wordsText(language, { level: "normal" }, seed)) {
          expect(top.has(bare(word)), word).toBe(true);
          expect(letters(word), word).toBeLessThanOrEqual(9);
        }
    });

    it(`${language} hard: at least 30 % of words have 8+ letters or a rare letter`, () => {
      for (const seed of SEEDS)
        for (const count of [10, 11, 50, 500]) {
          const words = wordsText(language, { level: "hard" }, seed, count);
          expect(share(words, (w) => letters(w) >= 8 || rare(w, language))).toBeGreaterThanOrEqual(
            0.3,
          );
        }
    });
  }
});

describe("words mode custom recipe (C5)", () => {
  const custom = (
    wordLength: "short" | "medium" | "long",
    rareLetters: boolean,
    punctuationDensity: "none" | "light" | "heavy",
  ): Difficulty => ({ level: "custom", wordLength, rareLetters, punctuationDensity });
  const inBand = {
    short: (w: string) => letters(w) <= 4,
    medium: (w: string) => letters(w) >= 5 && letters(w) <= 7,
    long: (w: string) => letters(w) >= 8,
  };

  for (const language of LANGUAGES)
    for (const wordLength of ["short", "medium", "long"] as const)
      for (const rareLetters of [true, false])
        it(`${language} ${wordLength} rare=${rareLetters}: >= 60 % in length, >= 25 % rare (or none)`, () => {
          for (const seed of SEEDS)
            for (const count of [10, 11, 50, 500]) {
              const words = wordsText(
                language,
                custom(wordLength, rareLetters, "none"),
                seed,
                count,
              );
              expect(share(words, inBand[wordLength])).toBeGreaterThanOrEqual(0.6);
              const rareShare = share(words, (w) => rare(w, language));
              if (rareLetters) expect(rareShare).toBeGreaterThanOrEqual(0.25);
              else expect(rareShare).toBe(0);
            }
        });

  for (const language of LANGUAGES) {
    it(`${language} punctuation none: no mark`, () => {
      for (const seed of SEEDS) {
        const words = wordsText(language, custom("medium", false, "none"), seed);
        expect(words.filter((w) => /[,.!?;:]/.test(w))).toEqual([]);
      }
    });

    it(`${language} punctuation light: one mark appended per 8 to 12 words`, () => {
      for (const seed of SEEDS)
        for (const count of [10, 11, 50, 500]) {
          const words = wordsText(language, custom("medium", false, "light"), seed, count);
          const at = words.flatMap((w, i) => (MARK.test(w) ? [i] : []));
          expect(words.every((w) => /^[^,.!?;:]+[,.!?;:]?$/.test(w))).toBe(true);
          [-1, ...at].slice(0, -1).forEach((prev, k) => {
            const gap = at[k]! - prev;
            expect(gap).toBeGreaterThanOrEqual(8);
            expect(gap).toBeLessThanOrEqual(12);
          });
          expect(words.length - 1 - (at.at(-1) ?? -1)).toBeLessThan(12);
        }
    });

    it(`${language} punctuation heavy: at least one mark in every 4 words`, () => {
      for (const seed of SEEDS)
        for (const count of [10, 11, 50, 500]) {
          const words = wordsText(language, custom("short", true, "heavy"), seed, count);
          for (let i = 0; i + 4 <= words.length; i++)
            expect(words.slice(i, i + 4).some((w) => MARK.test(w))).toBe(true);
        }
    });
  }
});

describe("sentences mode bands (C6)", () => {
  it("passageScore grows with word length, rare letters and punctuation", () => {
    const base = passageScore("the cat sat on the mat and the dog ran to it", "en");
    expect(
      passageScore("the beautiful elephant wandered through extraordinary landscapes", "en"),
    ).toBeGreaterThan(base);
    expect(passageScore("the jaw sat on the zoo and the fox ran to it", "en")).toBeGreaterThan(
      base,
    );
    expect(passageScore("the cat, sat; on the mat! and the dog? ran to it.", "en")).toBeGreaterThan(
      base,
    );
  });

  it("bands by the exported thresholds", () => {
    for (const language of LANGUAGES) {
      const { easy, hard } = BAND_THRESHOLDS[language];
      expect(bandOfScore(easy - 0.01, language)).toBe("easy");
      expect(bandOfScore(easy, language)).toBe("normal");
      expect(bandOfScore(hard, language)).toBe("hard");
    }
  });

  for (const language of LANGUAGES) {
    const passages = fileProvider.sentences(language);
    for (const level of ["easy", "normal", "hard"] as const) {
      it(`${language} ${level}: draws only from the ${level} band (>= ${MIN_BAND_PASSAGES} passages)`, () => {
        const band = passagesFor(passages, { level }, language);
        expect(band.length).toBeGreaterThanOrEqual(MIN_BAND_PASSAGES);
        expect(band.length).toBeLessThan(passages.length);
        for (const p of band)
          expect(bandOfScore(passageScore(p.text, language), language)).toBe(level);
        const texts = band.map((p) => p.text);
        for (const seed of SEEDS.slice(0, 5)) {
          const { content } = generateRaceText(
            { ...DEFAULT_RACE_SETTINGS, language, wordCount: 12, difficulty: { level } },
            { rng: mulberry32(seed) },
          );
          expect(
            texts.some((t) => t.startsWith(content)),
            content,
          ).toBe(true);
        }
      });
    }
  }

  it("custom picks the nearest band by its recipe", () => {
    const c = (wordLength: "short" | "long", rareLetters: boolean, p: "none" | "heavy") =>
      ({ level: "custom", wordLength, rareLetters, punctuationDensity: p }) as const;
    for (const language of LANGUAGES) {
      expect(bandOf(c("short", false, "none"), language)).toBe("easy");
      expect(bandOf(c("long", true, "heavy"), language)).toBe("hard");
    }
    expect(bandOf({ level: "normal" }, "en")).toBe("normal");
  });

  it("widens to every passage when fewer than 5 match", () => {
    const few: SeedSentence[] = [
      { text: "a b c d e f g h i j k l", source: "x" },
      { text: "extraordinary circumstances overwhelmingly demonstrated", source: "x" },
    ];
    expect(passagesFor(few, { level: "hard" }, "en")).toBe(few);
  });
});
