import { describe, expect, it } from "vitest";
import {
  BOT_LEVEL_WPM,
  DEFAULT_RACE_SETTINGS,
  engineSettingsOf,
  MAX_BOTS,
  raceSettingsPatchSchema,
  raceSettingsSchema,
  withDefaults,
} from "./index";

const d = DEFAULT_RACE_SETTINGS;
const custom = {
  level: "custom",
  wordLength: "short",
  rareLetters: true,
  punctuationDensity: "light",
} as const;

describe("raceSettingsSchema", () => {
  it.each([
    ["the defaults", d, true],
    ["a custom difficulty", { ...d, difficulty: custom }, true],
    ["a timer of 60 s", { ...d, timerS: 60 }, true],
    ["29 bots", { ...d, bots: Array.from({ length: MAX_BOTS }, () => ({ level: "major" })) }, true],
    ["12 practice letters", { ...d, practiceLetters: [..."abcdefghijkl"] }, true],
    ["practice letters é, a and Ç", { ...d, practiceLetters: ["\u00E9", "a", "\u00C7"] }, true],
    ["wordCount 9", { ...d, wordCount: 9 }, false],
    ["wordCount 501", { ...d, wordCount: 501 }, false],
    ["wordCount 10.5", { ...d, wordCount: 10.5 }, false],
    ["timerS 59", { ...d, timerS: 59 }, false],
    ["timerS 601", { ...d, timerS: 601 }, false],
    ['timerS "60"', { ...d, timerS: "60" }, false],
    [
      "a custom difficulty without punctuationDensity",
      { ...d, difficulty: { ...custom, punctuationDensity: undefined } },
      false,
    ],
    ["13 practice letters", { ...d, practiceLetters: [..."abcdefghijklm"] }, false],
    ["a duplicate practice letter", { ...d, practiceLetters: ["a", "b", "a"] }, false],
    ["a two-character practice letter", { ...d, practiceLetters: ["ab"] }, false],
    ["an NFD practice letter", { ...d, practiceLetters: ["é"] }, false],
    ["a NUL practice letter", { ...d, practiceLetters: ["\u0000"] }, false],
    ["a BEL practice letter", { ...d, practiceLetters: ["\u0007"] }, false],
    ["a zero-width space practice letter", { ...d, practiceLetters: ["\u200B"] }, false],
    ["a zero-width joiner practice letter", { ...d, practiceLetters: ["\u200D"] }, false],
    ["a space practice letter", { ...d, practiceLetters: [" "] }, false],
    ["a digit practice letter", { ...d, practiceLetters: ["5"] }, false],
    ["an emoji practice letter", { ...d, practiceLetters: ["\u{1F98A}"] }, false],
    ["a non-typeable letter", { ...d, practiceLetters: ["\u0436"] }, false],
    ["30 bots", { ...d, bots: Array.from({ length: 30 }, () => ({ level: "clerk" })) }, false],
    ["an unknown bot level", { ...d, bots: [{ level: "general" }] }, false],
    ["an unknown key", { ...d, theme: "dark" }, false],
  ] as const)("%s", (_, payload, ok) => {
    expect(raceSettingsSchema.safeParse(payload).success).toBe(ok);
  });

  it("fixes the bot levels and the bot cap", () => {
    expect(BOT_LEVEL_WPM).toEqual({
      recruit: 20,
      clerk: 35,
      officer: 50,
      commissar: 70,
      major: 90,
    });
    expect(MAX_BOTS).toBe(29);
  });
});

describe("raceSettingsPatchSchema", () => {
  it.each([
    ["{}", {}, true],
    ["{ timerS: null }", { timerS: null }, true],
    ['{ lobbyType: "public" }', { lobbyType: "public" }, false],
    ["{ wordCount: 5 }", { wordCount: 5 }, false],
  ] as const)("%s", (_, payload, ok) => {
    expect(raceSettingsPatchSchema.safeParse(payload).success).toBe(ok);
  });
});

describe("helpers", () => {
  it("withDefaults merges a partial over the defaults", () => {
    expect(withDefaults({ wordCount: 120 })).toEqual({ ...d, wordCount: 120 });
    expect(withDefaults({})).toEqual(d);
  });

  it("withDefaults throws on an invalid merge", () => {
    expect(() => withDefaults({ wordCount: 5 })).toThrow();
  });

  it("engineSettingsOf returns exactly the engine subset", () => {
    expect(engineSettingsOf({ ...d, errorMode: "block", backspace: false })).toStrictEqual({
      errorMode: "block",
      backspace: false,
    });
  });
});
