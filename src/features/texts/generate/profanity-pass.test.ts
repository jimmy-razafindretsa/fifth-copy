import { describe, expect, it } from "vitest";
import { mulberry32 } from "@fifth-copy/engine";
import { isClean } from "../profanity/is-clean";
import { EN } from "../profanity/lists/en";
import { generateRaceText } from "./generate";
import { LANGUAGES, raceSettings, SEEDS } from "./test-helpers";
import { cleanTokens, MAX_REDRAWS } from "./transforms/profanity-pass";
import type { TextProvider } from "./types";

// Contract of #354 C5: the profanity pass. The blocked word and pair are taken from the filter's own
// list, so no word is written out here.

const BLOCKED = EN.map((e) => e.word).find((w) => /^[a-z]{3,6}$/.test(w) && !isClean(w))!;
/** Two clean words that are blocked only together. */
const PAIR = EN.flatMap(({ word }) => {
  if (!/^[a-z]{5,}$/.test(word)) return [];
  for (let i = 2; i < word.length - 1; i++) {
    const [a, b] = [word.slice(0, i), word.slice(i)];
    if (isClean(a) && isClean(b) && !isClean(`${a} ${b}`)) return [[a, b] as const];
  }
  return [];
})[0]!;
const FILLER = ["paper", "desk", "stamp", "ink", "file", "clerk", "form", "memo"];

const provider = (words: string[]): TextProvider => ({
  sourceRef: () => "test",
  sentences: () => [{ text: words.join(" "), source: "test" }],
  words: () => words,
});
const SHORT = {
  level: "custom",
  wordLength: "short",
  rareLetters: true,
  punctuationDensity: "none",
} as const;

const allClean = (content: string) => {
  const tokens = content.split(" ");
  return tokens.every((t, i) => isClean(t) && (i === 0 || isClean(`${tokens[i - 1]} ${t}`)));
};

describe("profanity pass (C5)", () => {
  it("found a blocked word and a pair blocked only together", () => {
    expect(isClean(BLOCKED)).toBe(false);
    expect([isClean(PAIR[0]), isClean(PAIR[1]), isClean(PAIR.join(" "))]).toEqual([
      true,
      true,
      false,
    ]);
  });

  it("a test list's blocked word and blocked pair are both redrawn", () => {
    const list = [BLOCKED, PAIR[0], PAIR[1], ...FILLER];
    let pairsSeen = 0;
    for (const textType of ["words", "special-characters", "sentences"] as const) {
      for (const seed of SEEDS) {
        const { content, wordCount } = generateRaceText(
          raceSettings("en", textType, { wordCount: 100, difficulty: SHORT }),
          { rng: mulberry32(seed), provider: provider(list) },
        );
        expect(wordCount).toBe(100);
        expect(allClean(content), content).toBe(true);
        const words = content.split(" ").map((t) => t.replace(/[^a-z]/g, ""));
        expect(words).not.toContain(BLOCKED);
        // the halves stay (each is clean), never side by side
        if (words.includes(PAIR[0]) && words.includes(PAIR[1])) pairsSeen++;
      }
    }
    expect(pairsSeen).toBeGreaterThan(0);
  });

  it("gives up after 20 redraws of one slot, drops the word, never throws", () => {
    let redraws = 0;
    const out = cleanTokens(["desk", BLOCKED, "memo"], () => {
      redraws++;
      return BLOCKED;
    });
    expect(MAX_REDRAWS).toBe(20);
    expect(redraws).toBe(20);
    expect(out).toEqual(["desk", "memo"]);
  });

  it("a dropped word is refilled: the count still holds", () => {
    // only one clean word: every blocked slot redraws to it
    const { content, wordCount } = generateRaceText(
      raceSettings("en", "words", { wordCount: 50, difficulty: SHORT }),
      { rng: mulberry32(3), provider: provider([BLOCKED, BLOCKED, "desk"]) },
    );
    expect(wordCount).toBe(50);
    expect(allClean(content)).toBe(true);
  });

  it("a list with no clean word gives an empty text, never throws", () => {
    const text = generateRaceText(
      raceSettings("en", "words", { wordCount: 10, difficulty: SHORT }),
      {
        rng: mulberry32(1),
        provider: provider([BLOCKED]),
      },
    );
    expect(text.content).toBe("");
  });

  for (const language of LANGUAGES) {
    it(`${language}: every word and pair of real texts is clean, all toggles on`, () => {
      for (const textType of ["sentences", "words", "special-characters"] as const) {
        for (const seed of SEEDS) {
          const s = raceSettings(language, textType, {
            wordCount: 300,
            includeNumbers: true,
            includeSymbols: true,
            accentEveryWord: true,
            practiceLetters: ["a"],
          });
          const { content } = generateRaceText(s, { rng: mulberry32(seed) });
          expect(allClean(content), content).toBe(true);
        }
      }
    });
  }
});
