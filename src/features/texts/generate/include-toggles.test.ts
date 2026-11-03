import { describe, expect, it } from "vitest";
import { mulberry32 } from "@fifth-copy/engine";
import type { RaceSettings, TextType } from "@fifth-copy/protocol";
import { generateRaceText } from "./generate";
import { LANGUAGES, PRESETS, raceSettings, SEEDS } from "./test-helpers";
import { hasDigit, hasSymbol, isWord, PUNCTUATION, SYMBOLS } from "./tokens";
import { BLOCK } from "./transforms/include-toggles";

// Contract of #354 C4: numbers, symbols and punctuation toggles.

const TYPES: TextType[] = ["sentences", "words", "special-characters"];
const MARKS = /[,.!?;:'"]/;

/** Every text of a language and type over the presets, two lengths and the seeds. */
function* texts(over: Partial<RaceSettings>, types = TYPES) {
  for (const language of LANGUAGES)
    for (const textType of types)
      for (const difficulty of PRESETS)
        for (const wordCount of [10, 200])
          for (const seed of SEEDS.slice(0, 10)) {
            const s = raceSettings(language, textType, { difficulty, wordCount, ...over });
            yield { s, content: generateRaceText(s, { rng: mulberry32(seed) }).content, seed };
          }
}

describe("include toggles (C4)", () => {
  it("uses the contract's sets", () => {
    expect(SYMBOLS.join(" ")).toBe("# $ % & * + = @ / \\ ( ) [ ] { } < > _ | ~");
    expect(PUNCTUATION.join(" ")).toBe(", . ! ? ; : ' \"");
    expect(BLOCK).toBe(10);
  });

  it("includeNumbers: false gives no digit", () => {
    for (const { content } of texts({ includeNumbers: false, includeSymbols: true }))
      expect(content).not.toMatch(/\d/);
  });

  it("includeSymbols: false gives no symbol of the set", () => {
    for (const { content } of texts({ includeSymbols: false, includeNumbers: true }))
      expect(hasSymbol(content), content).toBe(false);
  });

  it("includePunctuation: false gives no mark (sentences strip them, words never add them)", () => {
    for (const { content } of texts({ includePunctuation: false, includeSymbols: true }))
      expect(content, content).not.toMatch(MARKS);
  });

  it("sentences keep their marks when punctuation is on", () => {
    const all = [...texts({ includePunctuation: true }, ["sentences"])];
    expect(all.filter(({ content }) => MARKS.test(content)).length).toBeGreaterThan(all.length / 2);
  });

  for (const [toggle, has] of [
    ["includeNumbers", hasDigit],
    ["includeSymbols", hasSymbol],
  ] as const) {
    it(`${toggle}: true puts one in at least one word per 10 (words and the drill)`, () => {
      for (const { s, content, seed } of texts({ [toggle]: true }, [
        "words",
        "special-characters",
      ])) {
        const words = content.split(" ").filter(isWord);
        const n = words.filter(has).length;
        if (n < Math.floor(words.length / BLOCK)) expect({ s, seed, n, content }).toBeNull();
        for (let b = 0; b < words.length; b += BLOCK)
          expect(words.slice(b, b + BLOCK).some(has), `${seed} ${content}`).toBe(true);
      }
    });
  }
});
