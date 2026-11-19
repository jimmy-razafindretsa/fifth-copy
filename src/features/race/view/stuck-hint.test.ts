import { describe, expect, it } from "vitest";
import { selectStuckChar, STUCK_HINT_ERRORS, STUCK_HINT_MS, stuckHintHref } from "./stuck-hint";

// Contract of #999 C30 (and C31's timing): `selectStuckChar` picks the first special character (one the
// guide files, `guideAnchor`) with at least 3 wrong presses that was not hinted yet in this race; a
// plain letter never makes a hint. The hint stays `STUCK_HINT_MS` (8 s), a named constant (C31).

const map = (entries: [string, number][]) => new Map(entries);

describe("selectStuckChar (#999 C30)", () => {
  it("the threshold is 3 wrong presses and the hint stays 8 s", () => {
    expect(STUCK_HINT_ERRORS).toBe(3);
    expect(STUCK_HINT_MS).toBe(8_000);
  });

  it("null with no errors, or below 3 on a special character", () => {
    expect(selectStuckChar(new Map(), new Set())).toBeNull();
    expect(selectStuckChar(map([["ç", 2]]), new Set())).toBeNull();
  });

  it("the special character at 3 or more errors", () => {
    expect(selectStuckChar(map([["ç", 3]]), new Set())).toBe("ç");
    expect(selectStuckChar(map([["é", 7]]), new Set())).toBe("é");
  });

  it("a plain letter, a digit or a space never makes a hint", () => {
    expect(
      selectStuckChar(
        map([
          ["e", 9],
          ["7", 5],
          [" ", 4],
        ]),
        new Set(),
      ),
    ).toBeNull();
  });

  it("the first special character in error order, skipping the plain ones", () => {
    expect(
      selectStuckChar(
        map([
          ["a", 5],
          ["è", 1],
          ["ç", 4],
          ["€", 6],
        ]),
        new Set(),
      ),
    ).toBe("ç");
  });

  it("a character hinted in this race never again; the next stuck one comes up", () => {
    const errors = map([
      ["ç", 3],
      ["œ", 3],
    ]);
    expect(selectStuckChar(errors, new Set(["ç"]))).toBe("œ");
    expect(selectStuckChar(errors, new Set(["ç", "œ"]))).toBeNull();
  });

  it("the upper case is the same character (one guide entry): hinted `ç` covers `Ç`", () => {
    expect(selectStuckChar(map([["Ç", 3]]), new Set())).toBe("Ç");
    expect(selectStuckChar(map([["Ç", 3]]), new Set(["ç"]))).toBeNull();
  });
});

describe("stuckHintHref (#999 C31)", () => {
  it("the guide's anchor for the character", () => {
    expect(stuckHintHref("ç")).toBe("/guide#c-cedilla");
    expect(stuckHintHref("Ç")).toBe("/guide#c-cedilla");
    expect(stuckHintHref("«")).toBe("/guide#guillemet-open");
  });
});
