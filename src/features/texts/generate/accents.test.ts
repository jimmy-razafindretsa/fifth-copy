import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { mulberry32, normalizeTypeable } from "@fifth-copy/engine";
import { fileProvider } from "../corpus/files";
import { generateRaceText } from "./generate";
import { sentencePassages } from "./strategies";
import { PRESETS, raceSettings, SEEDS, textWords } from "./test-helpers";
import { ACCENTS, hasAccent } from "./tokens";
import { accentRatio } from "./transforms/accents";

// Contract of #354 C3: every-word accent (French).

describe("every-word accent (C3)", () => {
  it("uses the contract's accent set", () => {
    expect(ACCENTS.join(" ")).toBe("é è ê ë à â ç î ï ô ù û ü œ");
  });

  for (const textType of ["words", "special-characters"] as const) {
    for (const extras of [
      {},
      { includeNumbers: true, includeSymbols: true, practiceLetters: ["s"] },
    ]) {
      const label = Object.keys(extras).length ? "with numbers, symbols, letters" : "defaults";
      it(`fr ${textType} (${label}): every word holds an accented letter`, () => {
        for (const difficulty of PRESETS) {
          for (const wordCount of [10, 100, 500]) {
            for (const seed of SEEDS) {
              const s = raceSettings("fr", textType, {
                difficulty,
                wordCount,
                accentEveryWord: true,
                ...extras,
              });
              const words = textWords(s, seed);
              expect(words).toHaveLength(wordCount);
              const bare = words.filter((w) => !hasAccent(w));
              if (bare.length) expect({ difficulty, wordCount, seed, bare }).toBeNull();
            }
          }
        }
      });
    }
  }

  it("fr sentences: the passages with the highest accented-word ratio are drawn first", () => {
    const passages = fileProvider.sentences("fr");
    const s = raceSettings("fr", "sentences", { wordCount: 12, accentEveryWord: true });
    const band = sentencePassages(passages, s);
    const all = sentencePassages(passages, { ...s, accentEveryWord: false });
    expect(band.length).toBeLessThan(all.length);
    const floor = Math.min(...band.map((p) => accentRatio(p.text)));
    for (const p of all)
      if (!band.includes(p)) expect(accentRatio(p.text)).toBeLessThanOrEqual(floor);
    for (const seed of SEEDS) {
      const { content } = generateRaceText(s, { rng: mulberry32(seed) });
      expect(
        band.some((p) => normalizeTypeable(p.text).startsWith(content)),
        content,
      ).toBe(true);
    }
  });

  it("changes nothing for an English race", () => {
    for (const textType of ["sentences", "words", "special-characters"] as const) {
      for (const seed of SEEDS) {
        const off = generateRaceText(raceSettings("en", textType, { wordCount: 60 }), {
          rng: mulberry32(seed),
        });
        const on = generateRaceText(
          raceSettings("en", textType, { wordCount: 60, accentEveryWord: true }),
          { rng: mulberry32(seed) },
        );
        expect(on).toEqual(off);
      }
    }
  });

  it("question 24 is recorded as settled", () => {
    const requirements = fs.readFileSync("work/plan/fifth-copy-requirements.md", "utf8");
    expect(requirements).toMatch(/24\..*\n.*#354/);
  });
});
