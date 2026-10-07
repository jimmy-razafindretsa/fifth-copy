import { describe, expect, it } from "vitest";
import { normalizeTypeable, wordCount, type Rng } from "@fifth-copy/engine";
import { DEFAULT_RACE_SETTINGS, type RaceLanguage, type TextType } from "@fifth-copy/protocol";
import { generateRaceText } from "../index";
import { seedProvider } from "./generate";
import { SEED_EN } from "./seed-en";
import { SEED_FR } from "./seed-fr";

// Seeded mulberry32 (copied from packages/engine/src/testing/rng.ts, which is internal).
function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ACCENT = /[àâæçèéêëîïôùûüÿœÀÂÆÇÈÉÊËÎÏÔÙÛÜŸŒ]/;
const settings = (language: RaceLanguage, count: number, textType: TextType = "sentences") => ({
  ...DEFAULT_RACE_SETTINGS,
  language,
  wordCount: count,
  textType,
});

describe("generateRaceText (C3)", () => {
  const languages: RaceLanguage[] = ["fr", "en"];
  const textTypes: TextType[] = ["sentences", "words", "special-characters"];

  for (const language of languages) {
    for (const textType of textTypes) {
      for (const count of [10, 50, 120, 500]) {
        it(`${language} ${textType} ${count}: exact word count, typeable, deterministic`, () => {
          for (const seed of [1, 2, 3, 42, 1234]) {
            const text = generateRaceText(settings(language, count, textType), {
              rng: mulberry32(seed),
            });
            expect(wordCount(text.content)).toBe(count);
            expect(text.wordCount).toBe(count);
            expect(text.content).toBe(normalizeTypeable(text.content));
            expect(text.language).toBe(language);
            expect(text.sourceRef).toBe(`seed:${language}:v1`);
            // Sentence texts only: a `words` draw is random vocabulary (accents per word are #354).
            if (language === "fr" && textType !== "words") expect(text.content).toMatch(ACCENT);
            const again = generateRaceText(settings(language, count, textType), {
              rng: mulberry32(seed),
            });
            expect(again).toEqual(text);
          }
        });
      }
    }

    it(`${language}: two seeds give two different texts`, () => {
      for (const textType of textTypes) {
        const a = generateRaceText(settings(language, 50, textType), { rng: mulberry32(1) });
        const b = generateRaceText(settings(language, 50, textType), { rng: mulberry32(2) });
        expect(a.content).not.toBe(b.content);
      }
    });
  }

  it("defaults to Math.random and the seed provider", () => {
    const text = generateRaceText(settings("en", 10));
    expect(wordCount(text.content)).toBe(10);
  });

  it("uses an injected provider (the #351/#354 seam)", () => {
    const provider = {
      sourceRef: () => "corpus:test",
      sentences: () => [{ text: "un deux trois quatre cinq", source: "test" }],
    };
    const text = generateRaceText(settings("fr", 10), { rng: mulberry32(1), provider });
    expect(text).toEqual({
      content: "un deux trois quatre cinq un deux trois quatre cinq",
      language: "fr",
      wordCount: 10,
      sourceRef: "corpus:test",
    });
  });
});

describe("seed files (C3)", () => {
  for (const [language, seed] of [
    ["fr", SEED_FR],
    ["en", SEED_EN],
  ] as const) {
    it(`${language}: >= 30 attributed sentences, each typeable as written`, () => {
      expect(seed.length).toBeGreaterThanOrEqual(30);
      expect(seedProvider.sentences(language)).toBe(seed);
      for (const { text, source } of seed) {
        expect(text).toBe(normalizeTypeable(text));
        expect(source.length).toBeGreaterThan(0);
      }
      expect(new Set(seed.map((s) => s.text)).size).toBe(seed.length);
    });
  }

  it("fr: every sentence has at most 12 words and an accent within its first 10 words", () => {
    for (const { text } of SEED_FR) {
      expect(wordCount(text), text).toBeLessThanOrEqual(12);
      const first10 = generateRaceText(settings("fr", 10), {
        rng: () => 0,
        provider: { sourceRef: () => "x", sentences: () => [{ text, source: "x" }] },
      }).content;
      expect(first10, text).toMatch(ACCENT);
    }
  });
});
