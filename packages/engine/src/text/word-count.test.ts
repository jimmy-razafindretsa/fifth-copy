import { describe, expect, it } from "vitest";
import { wordCount } from "./word-count";

describe("wordCount", () => {
  it.each([
    ["", 0],
    ["   ", 0],
    ["bonjour", 1],
    ["Le chat dort.", 3],
    ["The quick brown fox jumps over the lazy dog.", 9],
    ["Quoi\u00A0? Déjà fini\u00A0!", 3],
    ["«\u00A0Camarade\u00A0», dit-il.", 2],
    ["double  spaces   here", 3],
    ["  leading and trailing  ", 3],
    ["l’été arrive… enfin", 3],
    ["What? Already\u00A0!", 2],
    ["It's 10:45, isn't it?", 4],
    ["un — deux", 2],
  ])("wordCount(%j) is %d", (s, n) => {
    expect(wordCount(s)).toBe(n);
  });
});
