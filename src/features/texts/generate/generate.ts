import { normalizeTypeable, wordCount, type Rng } from "@fifth-copy/engine";
import { DEFAULT_RACE_SETTINGS, type RaceSettings } from "@fifth-copy/protocol";
import { fileProvider } from "../corpus/files";
import { STRATEGIES } from "./strategies";
import type { GeneratedText, TextProvider } from "./types";

export type GenerateSettings = Pick<RaceSettings, "language" | "textType" | "wordCount"> &
  Partial<Pick<RaceSettings, "difficulty">>;

/**
 * Builds one race text from the host's settings (ADR 0006 point 6, ARCHITECTURE 8.2): exactly
 * `settings.wordCount` words (engine `wordCount`), passed through the engine's `normalizeTypeable`,
 * in `settings.language`, at `settings.difficulty` (default normal). Pure: same settings and `rng`,
 * same text. Dispatches through `STRATEGIES` (strategies.ts); the text comes from `provider`
 * (default `fileProvider`: the content files and frequency lists of `corpus/`).
 *
 * Accepted and ignored until #354: `practiceLetters`, `accentEveryWord` and the include toggles.
 * The default rng is `Math.random`: picking a text is not a secret.
 */
export function generateRaceText(
  settings: GenerateSettings,
  { rng = Math.random, provider = fileProvider }: { rng?: Rng; provider?: TextProvider } = {},
): GeneratedText {
  const { language, wordCount: target } = settings;
  const difficulty = settings.difficulty ?? DEFAULT_RACE_SETTINGS.difficulty;
  const strategy = STRATEGIES[settings.textType];
  const content = normalizeTypeable(
    strategy({ settings: { language, wordCount: target, difficulty }, rng, provider }),
  );
  return {
    content,
    language,
    wordCount: wordCount(content),
    sourceRef: provider.sourceRef(language),
  };
}
