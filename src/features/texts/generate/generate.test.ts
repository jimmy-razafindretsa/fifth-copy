import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { mulberry32, normalizeTypeable, wordCount } from "@fifth-copy/engine";
import {
  DEFAULT_RACE_SETTINGS,
  type Difficulty,
  type RaceLanguage,
  type TextType,
} from "@fifth-copy/protocol";
import { generateRaceText } from "../index";
import { fileProvider } from "../corpus/files";
import { drillStrategy } from "./drill";
import { sentenceStrategy, STRATEGIES, wordStrategy } from "./strategies";
import type { TextProvider } from "./types";

// Contract of #351 C3, C4, C7 (and #199's exact count, carried over); #354 C6 at the end.

const LANGUAGES: RaceLanguage[] = ["fr", "en"];
const TEXT_TYPES: TextType[] = ["sentences", "words", "special-characters"];
const DIFFICULTIES: Difficulty[] = [
  { level: "easy" },
  { level: "normal" },
  { level: "hard" },
  ...(["short", "medium", "long"] as const).flatMap((wordLength) =>
    [true, false].flatMap((rareLetters) =>
      (["none", "light", "heavy"] as const).map((punctuationDensity): Difficulty => ({
        level: "custom",
        wordLength,
        rareLetters,
        punctuationDensity,
      })),
    ),
  ),
];
const COUNTS = [10, 11, 50, 499, 500];
const SEEDS = Array.from({ length: 50 }, (_, i) => i + 1);

const settings = (
  language: RaceLanguage,
  wordCount: number,
  textType: TextType = "sentences",
  difficulty: Difficulty = { level: "normal" },
) => ({ ...DEFAULT_RACE_SETTINGS, language, wordCount, textType, difficulty });

const label = (d: Difficulty) =>
  d.level === "custom"
    ? `custom ${d.wordLength} ${d.rareLetters} ${d.punctuationDensity}`
    : d.level;

describe("exact count (C4)", () => {
  for (const language of LANGUAGES) {
    for (const textType of TEXT_TYPES) {
      for (const difficulty of DIFFICULTIES) {
        it(`${language} ${textType} ${label(difficulty)}: ${COUNTS.join(", ")} words over 50 rngs`, () => {
          for (const count of COUNTS) {
            for (const seed of SEEDS) {
              const text = generateRaceText(settings(language, count, textType, difficulty), {
                rng: mulberry32(seed),
              });
              if (
                wordCount(text.content) !== count ||
                normalizeTypeable(text.content) !== text.content
              )
                expect({ count, seed, content: text.content }).toBeNull();
              expect(text.wordCount).toBe(count);
              expect(text.language).toBe(language);
            }
          }
        }, 30_000);
      }
    }
  }
});

describe("strategy table and purity (C7)", () => {
  it("dispatches each text type; special-characters runs the drill (#354)", () => {
    expect(STRATEGIES.sentences).toBe(sentenceStrategy);
    expect(STRATEGIES.words).toBe(wordStrategy);
    expect(STRATEGIES["special-characters"]).toBe(drillStrategy);
  });

  for (const language of LANGUAGES) {
    it(`${language}: a seeded rng gives the same text twice, two seeds two texts`, () => {
      for (const textType of TEXT_TYPES) {
        const a = generateRaceText(settings(language, 50, textType), { rng: mulberry32(1) });
        expect(generateRaceText(settings(language, 50, textType), { rng: mulberry32(1) })).toEqual(
          a,
        );
        const b = generateRaceText(settings(language, 50, textType), { rng: mulberry32(2) });
        expect(a.content).not.toBe(b.content);
        expect(a.sourceRef).toBe(`files:${language}:v1`);
      }
    });
  }

  it("defaults to Math.random and the file provider", () => {
    const text = generateRaceText({
      ...DEFAULT_RACE_SETTINGS,
      language: "en",
      textType: "words",
      wordCount: 10,
    });
    expect(wordCount(text.content)).toBe(10);
    expect(text.sourceRef).toBe(fileProvider.sourceRef("en"));
  });

  it("uses an injected provider (the #346 seam)", () => {
    const provider: TextProvider = {
      sourceRef: () => "corpus:test",
      sentences: () => [{ text: "un deux trois quatre cinq", source: "test" }],
      words: () => ["mot"],
    };
    expect(generateRaceText(settings("fr", 10), { rng: mulberry32(1), provider })).toEqual({
      content: "un deux trois quatre cinq un deux trois quatre cinq",
      language: "fr",
      wordCount: 10,
      sourceRef: "corpus:test",
    });
    const words = generateRaceText(settings("fr", 10, "words", { level: "easy" }), {
      rng: mulberry32(1),
      provider,
    });
    expect(words.content).toBe(Array.from({ length: 10 }, () => "mot").join(" "));
  });
});

describe("words mode draws from the frequency lists (C3)", () => {
  for (const language of LANGUAGES) {
    it(`${language}: every word of a words text is in the list`, () => {
      const list = new Set(fileProvider.words(language));
      for (const seed of SEEDS.slice(0, 10)) {
        const { content } = generateRaceText(
          settings(language, 200, "words", {
            level: "custom",
            wordLength: "medium",
            rareLetters: true,
            punctuationDensity: "none",
          }),
          { rng: mulberry32(seed) },
        );
        for (const word of content.split(" ")) expect(list.has(word), word).toBe(true);
      }
    });
  }

  it("the corpus-vocabulary fallback is deleted", () => {
    const source = fs.readFileSync("src/features/texts/generate/generate.ts", "utf8");
    expect(source).not.toMatch(/function vocabulary/);
  });
});

describe("#354 C6: exact count and purity after every transform", () => {
  const PRESETS: Difficulty[] = [
    { level: "easy" },
    { level: "normal" },
    { level: "hard" },
    { level: "custom", wordLength: "long", rareLetters: true, punctuationDensity: "heavy" },
  ];
  const TOGGLES = {
    on: {
      accentEveryWord: true,
      practiceLetters: ["e", "r"],
      includeNumbers: true,
      includeSymbols: true,
      includePunctuation: true,
    },
    off: {
      accentEveryWord: false,
      practiceLetters: [],
      includeNumbers: false,
      includeSymbols: false,
      includePunctuation: false,
    },
  } as const;

  for (const language of LANGUAGES) {
    for (const textType of ["words", "special-characters", "sentences"] as const) {
      for (const [toggles, values] of Object.entries(TOGGLES)) {
        it(`${language} ${textType}, toggles ${toggles}: 4 presets, 10 and 500 words, 50 rngs`, () => {
          for (const difficulty of PRESETS) {
            for (const count of [10, 500]) {
              for (const seed of SEEDS) {
                const s = {
                  ...settings(language, count, textType, difficulty),
                  ...values,
                  practiceLetters: [...values.practiceLetters],
                };
                const { content } = generateRaceText(s, { rng: mulberry32(seed) });
                if (wordCount(content) !== count || normalizeTypeable(content) !== content)
                  expect({ difficulty, count, seed, content }).toBeNull();
              }
            }
          }
        }, 60_000);
      }
    }
  }

  it("generate.ts takes the full settings (no Pick)", () => {
    const source = fs.readFileSync("src/features/texts/generate/generate.ts", "utf8");
    expect(source).not.toMatch(/Pick<RaceSettings/);
  });
});
