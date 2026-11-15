import { describe, expect, it } from "vitest";
import { nextPlayKey, PLAY_KEYS } from "./store";
import { isMacPlatform, shortcutLabel } from "../view/play-shortcut";

// #951: a new, safe play key for every card dealt; shown as ⌥ K on a Mac, Alt+K elsewhere.
describe("play key (#951)", () => {
  it("is one of the safe letters and never the previous card's", () => {
    for (let at = 0; at < 50; at++) {
      for (const previous of [null, ...PLAY_KEYS]) {
        const key = nextPlayKey(previous, at * 977);
        expect(PLAY_KEYS).toContain(key);
        expect(key).not.toBe(previous);
      }
    }
  });

  it("the safe letters avoid every browser shortcut letter and the AZERTY moves", () => {
    for (const unsafe of [
      "W",
      "Q",
      "T",
      "N",
      "R",
      "A",
      "Z",
      "M",
      "F",
      "E",
      "D",
      "V",
      "S",
      "B",
      "H",
      "U",
      "I",
    ])
      expect(PLAY_KEYS as readonly string[]).not.toContain(unsafe);
  });

  it("labels the shortcut per platform", () => {
    expect(shortcutLabel("K", true)).toBe("⌥ K");
    expect(shortcutLabel("K", false)).toBe("Alt+K");
    expect(isMacPlatform({ platform: "MacIntel" })).toBe(true);
    expect(isMacPlatform({ platform: "Win32", userAgent: "Windows NT" })).toBe(false);
    expect(isMacPlatform(undefined)).toBe(false);
  });
});
