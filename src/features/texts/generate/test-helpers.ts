import { mulberry32 } from "@fifth-copy/engine";
import {
  DEFAULT_RACE_SETTINGS,
  type Difficulty,
  type RaceLanguage,
  type RaceSettings,
  type TextType,
} from "@fifth-copy/protocol";
import { generateRaceText } from "./generate";
import type { TextProvider } from "./types";

/** Shared fixtures of the #354 contract tests. */
export const LANGUAGES: readonly RaceLanguage[] = ["fr", "en"];
export const PRESETS: readonly Difficulty[] = [
  { level: "easy" },
  { level: "normal" },
  { level: "hard" },
  { level: "custom", wordLength: "long", rareLetters: true, punctuationDensity: "heavy" },
];
export const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

export const raceSettings = (
  language: RaceLanguage,
  textType: TextType,
  over: Partial<RaceSettings> = {},
): RaceSettings => ({ ...DEFAULT_RACE_SETTINGS, language, textType, ...over });

/** The words (tokens holding a letter or digit) of a generated text. */
export function textWords(settings: RaceSettings, seed: number, provider?: TextProvider): string[] {
  const { content } = generateRaceText(settings, { rng: mulberry32(seed), provider });
  return content.split(" ").filter((t) => /[\p{L}\p{N}]/u.test(t));
}

export const share = (words: readonly string[], test: (w: string) => boolean) =>
  words.filter(test).length / words.length;
