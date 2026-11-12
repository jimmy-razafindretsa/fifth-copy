import { describe, expect, it, vi } from "vitest";
import { isSpecialKey, MAX_LISTED_KEYS, missedKeys, type MissedKey } from "./keys";
import { coachingFrom, pickTip, TIP_IDS, type TipInput } from "./tip";

// The report links reach src/env.ts through the identity index (#899); these tests need no secrets.
vi.mock("@/env", () => ({ env: { NODE_ENV: "test" } }));

// Contract of #867 C2: `pickTip(input)` returns exactly one tip id from a closed list, in a fixed
// priority: clean (no error), special (the most-missed key is an accented letter, a guillemet or a
// character typed with a modifier, missed at least 3 times), key (any other key missed at least 3
// times; carries the character), accuracy (under 90 %), steady (otherwise). Same input, same tip.

const k = (char: string, count: number): MissedKey => ({ char, count });

describe("pickTip (#867 C2)", () => {
  it("the closed list, in priority order", () => {
    expect(TIP_IDS).toEqual(["clean", "special", "key", "accuracy", "steady"]);
  });

  it("clean: no error in the trace, whatever the accuracy", () => {
    expect(pickTip({ accuracy: 0.97, missed: [] })).toEqual({ id: "clean" });
    expect(pickTip({ accuracy: 0.5, missed: [] })).toEqual({ id: "clean" });
  });

  it("special: the most-missed key is an accented letter, a guillemet or € missed 3 times or more", () => {
    for (const char of ["é", "ç", "À", "œ", "«", "»", "€"]) {
      expect(pickTip({ accuracy: 0.8, missed: [k(char, 3), k("t", 2)] })).toEqual({
        id: "special",
        char,
        count: 3,
      });
    }
  });

  it("key: any other most-missed key missed 3 times or more, carrying the character", () => {
    expect(pickTip({ accuracy: 0.8, missed: [k("t", 4), k("é", 3)] })).toEqual({
      id: "key",
      char: "t",
      count: 4,
    });
    expect(pickTip({ accuracy: 0.99, missed: [k(" ", 3)] })).toEqual({
      id: "key",
      char: " ",
      count: 3,
    });
  });

  it("accuracy: no key missed 3 times and accuracy under 90 %", () => {
    expect(pickTip({ accuracy: 0.89, missed: [k("é", 2), k("t", 2)] })).toEqual({ id: "accuracy" });
  });

  it("steady: otherwise", () => {
    expect(pickTip({ accuracy: 0.9, missed: [k("t", 2)] })).toEqual({ id: "steady" });
    expect(pickTip({ accuracy: 0.96, missed: [k("é", 1)] })).toEqual({ id: "steady" });
  });

  it("no trace on file: chosen from the accuracy alone", () => {
    expect(pickTip({ accuracy: 1, missed: null })).toEqual({ id: "clean" });
    expect(pickTip({ accuracy: 0.85, missed: null })).toEqual({ id: "accuracy" });
    expect(pickTip({ accuracy: 0.95, missed: null })).toEqual({ id: "steady" });
  });

  it("same input, same tip; every tip is one id of the closed list", () => {
    const inputs: TipInput[] = [
      { accuracy: 1, missed: [] },
      { accuracy: 0.8, missed: [k("ê", 5)] },
      { accuracy: 0.8, missed: [k("q", 5)] },
      { accuracy: 0.7, missed: null },
      { accuracy: 0.95, missed: [k("q", 1)] },
    ];
    const ids = inputs.map((i) => pickTip(i).id);
    expect(ids).toEqual(["clean", "special", "key", "accuracy", "steady"]);
    for (const i of inputs) expect(pickTip(i)).toEqual(pickTip(structuredClone(i)));
  });
});

describe("missedKeys and the special keys (#867 C2, C3)", () => {
  it("only missed keys, most missed first, ties by character", () => {
    const tallies = [
      { char: "t", attempts: 9, errors: 2 },
      { char: "a", attempts: 4, errors: 0 },
      { char: "é", attempts: 3, errors: 3 },
      { char: " ", attempts: 8, errors: 2 },
      { char: "b", attempts: 2, errors: 2 },
    ];
    expect(missedKeys(tallies)).toEqual([k("é", 3), k(" ", 2), k("b", 2), k("t", 2)]);
  });

  it("special keys: everything outside printable ASCII", () => {
    for (const c of ["é", "É", "ç", "æ", "Œ", "ÿ", "«", "»", "€"])
      expect(isSpecialKey(c)).toBe(true);
    for (const c of ["a", "Z", " ", "!", "~", "'", '"']) expect(isSpecialKey(c)).toBe(false);
  });

  it("coaching lists at most five keys, null with no trace, and its tip", () => {
    const missed = [k("a", 6), k("b", 5), k("c", 4), k("d", 3), k("e", 2), k("f", 1)];
    const c = coachingFrom({ accuracy: 0.8, missed });
    expect(c.keys).toHaveLength(MAX_LISTED_KEYS);
    expect(c.keys!.map((m) => m.char)).toEqual(["a", "b", "c", "d", "e"]);
    expect(c.tip).toEqual({ id: "key", char: "a", count: 6 });
    expect(coachingFrom({ accuracy: 0.8, missed: null })).toEqual({
      keys: null,
      tip: { id: "accuracy" },
    });
  });
});
