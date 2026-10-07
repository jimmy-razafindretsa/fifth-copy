import { describe, expect, it } from "vitest";
import { charsOf } from "./chars";
import { normalizeTypeable, TYPEABLE } from "./normalize";

describe("charsOf", () => {
  it("splits a normalised text into one entry per character", () => {
    expect(charsOf(normalizeTypeable("cafe\u0301 cœur"))).toEqual([
      "c",
      "a",
      "f",
      "é",
      " ",
      "c",
      "œ",
      "u",
      "r",
    ]);
  });

  it("is one entry per UTF-16 unit for every whitelisted character", () => {
    const all = TYPEABLE.join("");
    expect(charsOf(all)).toHaveLength(all.length);
    expect(charsOf(all)).toEqual(TYPEABLE);
  });

  it("returns [] for the empty text", () => {
    expect(charsOf("")).toEqual([]);
  });
});
