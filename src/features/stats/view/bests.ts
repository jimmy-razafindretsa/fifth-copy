import type { Locale } from "@/i18n/locale";
import { STATS_TIME_ZONE } from "@/lib/time";
import type { BestLength, BestTextType } from "../personal-bests/rule";
import { LANGUAGES, type Language, type LanguageStats } from "./profile";

/**
 * "Records personnels / Personal bests" on the Personnel file (#999 C43, bible 14.3): pure display of
 * the viewer's stored personal bests (`PersonalBest`, one per language, text type and length, set by
 * the one rule in `personal-bests/rule.ts`) beside the French versus English comparison, which reads the
 * whole file's per-language figures (`Profile.languages`). Every speed is clean WPM (ADR 0016).
 */

/** One stored best as the screen reads it (the server query's row, `PersonalBestRow`). */
export type BestInput = {
  language: Language;
  textType: BestTextType;
  length: BestLength;
  cleanWpm: number;
  /** 0..1. */
  accuracy: number;
  achievedAt: Date;
};

/** none: no race and no best; one-language: races in one language only; populated: both. */
export type BestsState = "none" | "one-language" | "populated";

/** The French versus English line: who is faster on average, by how much, or only one on file. */
export type BestsVerdict =
  | { kind: "faster" | "slower"; diff: number }
  | { kind: "even" }
  | { kind: "only"; language: Language };

export type BestsView = {
  state: BestsState;
  /** FR then EN, each with its race count, best and average (null without a race in it). */
  compare: ({ language: Language } & LanguageStats)[];
  verdict: BestsVerdict | null;
  /** The bests, language then text type then length, in the settings' order. */
  rows: BestInput[];
};

const TYPE_ORDER: readonly BestTextType[] = ["SENTENCES", "WORDS", "SPECIAL_CHARACTERS"];
const LENGTH_ORDER: readonly BestLength[] = ["SHORT", "MEDIUM", "LONG"];

/** Under this gap in average clean WPM the two languages read as even. */
export const EVEN_GAP = 0.05;

/** The section's view from the stored bests and the file's per-language figures. */
export function bestsView(
  bests: readonly BestInput[],
  languages: Record<Language, LanguageStats>,
): BestsView {
  const raced = LANGUAGES.filter(
    (l) => languages[l].races > 0 || bests.some((b) => b.language === l),
  );
  const state: BestsState =
    raced.length === 0 ? "none" : raced.length === 1 ? "one-language" : "populated";
  const rows = [...bests].sort(
    (a, b) =>
      LANGUAGES.indexOf(a.language) - LANGUAGES.indexOf(b.language) ||
      TYPE_ORDER.indexOf(a.textType) - TYPE_ORDER.indexOf(b.textType) ||
      LENGTH_ORDER.indexOf(a.length) - LENGTH_ORDER.indexOf(b.length),
  );
  let verdict: BestsVerdict | null = null;
  const fr = languages.FR.meanWpm;
  const en = languages.EN.meanWpm;
  if (state === "one-language") verdict = { kind: "only", language: raced[0]! };
  else if (fr !== null && en !== null) {
    const gap = fr - en;
    verdict =
      Math.abs(gap) < EVEN_GAP
        ? { kind: "even" }
        : { kind: gap > 0 ? "faster" : "slower", diff: Math.abs(gap) };
  }
  return {
    state,
    compare: LANGUAGES.map((language) => ({ language, ...languages[language] })),
    verdict,
    rows,
  };
}

/** The day a best was set, short and upper case like a docket stamp (`12 NOV. 2026` / `NOV 12, 2026`). */
export function bestDate(at: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-CA" : "en-CA", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: STATS_TIME_ZONE,
  })
    .format(at)
    .toUpperCase();
}
