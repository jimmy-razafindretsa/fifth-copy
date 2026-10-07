import type { RaceLanguage } from "@fifth-copy/protocol";

/** One attributed sentence of a text source. */
export type SeedSentence = { readonly text: string; readonly source: string };

/**
 * Where race text comes from: the extension seam of `generateRaceText`. The seed provider is the
 * only implementation until the corpus and frequency-list providers of #351 and the drill of #354.
 */
export type TextProvider = {
  /** Stable reference stored on the race (`Race.textSourceRef`), at most 256 characters. */
  sourceRef(language: RaceLanguage): string;
  sentences(language: RaceLanguage): readonly SeedSentence[];
};

export type GeneratedText = {
  content: string;
  language: RaceLanguage;
  wordCount: number;
  sourceRef: string | null;
};
