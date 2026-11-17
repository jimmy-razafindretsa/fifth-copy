import { describe, expect, it } from "vitest";
import { emptyKeyFile, keyFileOf, REFERENCE_KEYS } from "./key-file";
import { KEY_FILE_FIXTURE_ROWS, keyFileFixtures } from "./key-file-fixtures";

// #961 C6: the key file fixtures for `/design` and the component tests are built by `keyFileOf`
// from fixture rows, never hand-written figures.

describe("keyFileFixtures (C6)", () => {
  it("names the three states", () => {
    expect(Object.keys(keyFileFixtures).sort()).toEqual(["empty", "threeDays", "twoWeeks"]);
  });

  it("each fixture is keyFileOf over its rows", () => {
    for (const name of ["empty", "threeDays", "twoWeeks"] as const) {
      const { chars, pairs } = KEY_FILE_FIXTURE_ROWS[name];
      expect(keyFileFixtures[name]).toEqual(keyFileOf(chars, pairs));
    }
  });

  it("empty is the empty file", () => {
    expect(keyFileFixtures.empty).toEqual(emptyKeyFile());
  });

  it("three days: three days on file, some keys never met", () => {
    const file = keyFileFixtures.threeDays;
    expect(file.days).toHaveLength(3);
    expect(file.keys.some((k) => k.state === "none")).toBe(true);
    expect(file.keys.some((k) => k.state !== "none")).toBe(true);
    expect(file.mostTyped).not.toBeNull();
  });

  it("two weeks: 14 days, every reference key met, accents typed, exactly one weak key, pairs listed", () => {
    const file = keyFileFixtures.twoWeeks;
    expect(file.days).toHaveLength(14);
    expect(file.keys.every((k) => k.hits > 0 && k.state !== "none")).toBe(true);
    for (const accent of ["é", "è", "à", "ç"]) expect(file.byChar[accent]?.hits).toBeGreaterThan(0);
    expect(file.keys.filter((k) => k.state === "weak")).toHaveLength(1);
    expect(file.keys.every((k) => k.learningRate !== null)).toBe(true);
    expect(file.pairs.length).toBeGreaterThan(0);
    // characters outside the 30 reference keys are on the map too
    expect(Object.keys(file.byChar).length).toBeGreaterThan(REFERENCE_KEYS.length);
  });
});
