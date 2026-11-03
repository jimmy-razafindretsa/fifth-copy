import { describe, expect, it } from "vitest";
import { normalizeTypeable } from "@fifth-copy/engine";
import { isClean } from "../profanity/is-clean";
import { wordsOf } from "./files";
import { wordListSchema, issuesOf } from "./schema";
import EN from "./words/en.json";
import FR from "./words/fr.json";

// Contract of #351 C3: one frequency list per language, attributed, at least 3000 words, each word
// lower-case, typeable and clean.

describe("frequency lists (C3)", () => {
  for (const [language, raw] of [
    ["fr", FR],
    ["en", EN],
  ] as const) {
    it(`${language}: valid, attributed, >= 3000 lower-case typeable clean words`, () => {
      const parsed = wordListSchema.safeParse(raw);
      expect(parsed.success ? [] : issuesOf(parsed.error).slice(0, 5)).toEqual([]);
      const list = parsed.data!;
      expect(list.language).toBe(language);
      expect(list.source.length).toBeGreaterThan(20);
      expect(list.licence.length).toBeGreaterThan(5);
      expect(list.words.length).toBeGreaterThanOrEqual(3000);
      for (const word of list.words) {
        expect(word, word).toBe(word.toLocaleLowerCase());
        expect(normalizeTypeable(word), word).toBe(word);
        expect(isClean(word), word).toBe(true);
      }
      expect(wordsOf(language)).toEqual(list.words);
    });
  }

  it("a bad word fails naming it", () => {
    const parsed = wordListSchema.safeParse({ ...EN, words: ["the", "Paris", "the"] });
    expect(parsed.success).toBe(false);
    const issues = issuesOf(parsed.error!);
    expect(issues).toContain('words.1: word "Paris" is not lower-case');
    expect(issues).toContain("words: words are distinct");
  });
});
