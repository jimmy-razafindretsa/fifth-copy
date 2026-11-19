import { describe, expect, it } from "vitest";
import { accentsRowOf } from "./accents-row";

// #999 C55: the accents row maps the key file's byChar onto the listed characters, in their order.

describe("accentsRowOf (C55)", () => {
  const byChar = {
    e: { hits: 300, errors: 3 },
    é: { hits: 40, errors: 4 },
    ç: { hits: 10, errors: 3 },
    "«": { hits: 0, errors: 0 },
  };

  it("one key per listed character, in order, caps upper case", () => {
    const row = accentsRowOf(byChar, ["é", "ç", "œ", "«"]);
    expect(row.map((k) => [k.char, k.cap, k.typed])).toEqual([
      ["é", "É", true],
      ["ç", "Ç", true],
      ["œ", "Œ", false],
      ["«", "«", false],
    ]);
  });

  it("circle share against the row's most struck key; strokes against every stroke on file", () => {
    const [e, c, oe] = accentsRowOf(byChar, ["é", "ç", "œ"]);
    expect(e).toMatchObject({ share: 1, ofStrokes: 40 / 350, errorRate: 0.1 });
    expect(c).toMatchObject({ share: 0.25, ofStrokes: 10 / 350, errorRate: 0.3 });
    expect(oe).toMatchObject({ share: 0, ofStrokes: 0, errorRate: null });
  });

  it("an empty file: every key untyped", () => {
    expect(accentsRowOf({}, ["é"]).every((k) => !k.typed)).toBe(true);
  });
});
