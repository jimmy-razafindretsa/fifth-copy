import type { RaceLanguage } from "@fifth-copy/protocol";

/** One attributed passage of a text source (a content-file passage and its file's `source`). */
export type SeedSentence = { readonly text: string; readonly source: string };

/**
 * Where race text comes from: the extension seam of `generateRaceText`. `fileProvider` (#351, the
 * committed content files and frequency lists) is the default; #346 plugs a database-backed one.
 */
export type TextProvider = {
  /** Stable reference stored on the race (`Race.textSourceRef`), at most 256 characters. */
  sourceRef(language: RaceLanguage): string;
  /** Passages for `sentences` mode: each 12 to 80 words, typeable as written. */
  sentences(language: RaceLanguage): readonly SeedSentence[];
  /** Words for `words` mode, most frequent first: lower-case, typeable, clean. */
  words(language: RaceLanguage): readonly string[];
};

export type GeneratedText = {
  content: string;
  language: RaceLanguage;
  wordCount: number;
  sourceRef: string | null;
};
