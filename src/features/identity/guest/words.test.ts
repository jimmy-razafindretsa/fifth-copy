import { describe, expect, it } from "vitest";
import { isClean } from "@/features/texts";
import { EN_WORDS, FR_WORDS } from "./words";

// Card #42, C6: guest typist names are drawn from these lists, so every word
// must pass the shared name filter of the texts feature.
describe("isClean over guest words", () => {
  it.each([
    ["EN", EN_WORDS],
    ["FR", FR_WORDS],
  ] as const)("every %s word passes isClean", (_lang, words) => {
    expect(words.filter((w) => !isClean(w))).toEqual([]);
  });
});
