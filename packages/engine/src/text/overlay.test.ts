import { describe, expect, it } from "vitest";
import { mulberry32, pickInt } from "../testing/rng";
import { baseLengthOf, EMPTY_OVERLAY, effectiveText, untypedBaseWords, wordsOf } from "./overlay";

const BASE = "Le formulaire est en triple exemplaire.";

// C1 (#190): effectiveText = base words minus `removed` indexes, plus `extra` words at the end.
describe("effectiveText (C1)", () => {
  it.each([
    { name: "no overlay", overlay: EMPTY_OVERLAY, text: BASE },
    {
      name: "extra only",
      overlay: { extra: ["vite", "encore"], removed: [] },
      text: `${BASE} vite encore`,
    },
    {
      name: "removed only",
      overlay: { extra: [], removed: [2, 3] },
      text: "Le formulaire triple exemplaire.",
    },
    {
      name: "both",
      overlay: { extra: ["visa"], removed: [1] },
      text: "Le est en triple exemplaire. visa",
    },
    {
      name: "removal of the last word",
      overlay: { extra: [], removed: [5] },
      text: "Le formulaire est en triple",
    },
    {
      name: "removal of the last word, then extra",
      overlay: { extra: ["tampon"], removed: [5] },
      text: "Le formulaire est en triple tampon",
    },
  ])("$name", ({ overlay, text }) => {
    expect(effectiveText(BASE, overlay)).toBe(text);
  });

  it("baseLengthOf is the length of the base part, extras excluded", () => {
    expect(baseLengthOf(BASE, EMPTY_OVERLAY)).toBe(BASE.length);
    expect(baseLengthOf(BASE, { extra: ["x"], removed: [] })).toBe(BASE.length);
    expect(baseLengthOf(BASE, { extra: [], removed: [5] })).toBe(
      "Le formulaire est en triple".length,
    );
  });

  it("wordsOf round-trips any space-separated text", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 200; i++) {
      const words = Array.from({ length: pickInt(rng, 8) }, () =>
        "ab".slice(0, 1 + pickInt(rng, 2)),
      );
      const text = words.join(" ");
      expect(wordsOf(text).join(" ")).toBe(text);
    }
    expect(wordsOf("")).toEqual([]);
  });
});

describe("untypedBaseWords", () => {
  // Positions: Le=0-1 ' '=2 formulaire=3-12 ' '=13 est=14-16 ...
  it.each([
    { cursor: 0, words: [1, 2, 3, 4, 5] },
    { cursor: 1, words: [1, 2, 3, 4, 5] },
    { cursor: 2, words: [2, 3, 4, 5] }, // on the space after "Le": "formulaire" is kept
    { cursor: 3, words: [2, 3, 4, 5] }, // first letter of "formulaire"
    { cursor: 13, words: [3, 4, 5] },
    { cursor: BASE.length - 1, words: [] },
  ])("reach $cursor -> $words", ({ cursor, words }) => {
    expect(untypedBaseWords(BASE, EMPTY_OVERLAY, cursor)).toEqual(words);
  });

  it("skips removed words and never offers an extra", () => {
    expect(untypedBaseWords(BASE, { extra: ["x"], removed: [2] }, 0)).toEqual([1, 3, 4, 5]);
    const inExtras = effectiveText(BASE, { extra: ["x", "y"], removed: [] }).length - 1;
    expect(untypedBaseWords(BASE, { extra: ["x", "y"], removed: [] }, inExtras)).toEqual([]);
  });
});
