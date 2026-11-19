/**
 * The one personal-best rule (#321, #999 C41, spec 13.2, ADR 0016), pure and shared by race-end
 * persistence (`record.ts`), the Dawn report headline and the Personnel file: a best is kept per text
 * language, text type and length bucket, compares clean WPM only (never `wpm`, `rawWpm` or
 * `adjustedWpm`), and only a counted, unflagged result (`isCountedResult`) can set one.
 */
import type { TextType } from "@fifth-copy/protocol";
import { isCountedResult, type CountableResult } from "../counted";

export type BestLanguage = "FR" | "EN";
export type BestTextType = "SENTENCES" | "WORDS" | "SPECIAL_CHARACTERS";
export type BestLength = "SHORT" | "MEDIUM" | "LONG";

/**
 * Length buckets by the race text's word count (`Race.textWordCount`): short up to 25 words, medium
 * up to 60, long above. Ordered; the first bucket whose `maxWords` holds the count wins.
 */
export const LENGTH_BUCKETS: readonly { length: BestLength; maxWords: number }[] = [
  { length: "SHORT", maxWords: 25 },
  { length: "MEDIUM", maxWords: 60 },
  { length: "LONG", maxWords: Number.POSITIVE_INFINITY },
];

const TEXT_TYPE: Record<TextType, BestTextType> = {
  sentences: "SENTENCES",
  words: "WORDS",
  "special-characters": "SPECIAL_CHARACTERS",
};

/** One personal best's key. */
export type BestKey = { language: BestLanguage; textType: BestTextType; length: BestLength };

/** The length bucket of a text of `wordCount` words. */
export function lengthOf(wordCount: number): BestLength {
  return (LENGTH_BUCKETS.find((b) => wordCount <= b.maxWords) ?? LENGTH_BUCKETS.at(-1)!).length;
}

/** The key of a race's best: its text language, its text type (from the settings), its length. */
export function bestKeyOf(race: {
  textLanguage: BestLanguage;
  textWordCount: number;
  textType: TextType;
}): BestKey {
  return {
    language: race.textLanguage,
    textType: TEXT_TYPE[race.textType],
    length: lengthOf(race.textWordCount),
  };
}

/** What the rule reads of a candidate result. */
export type BestCandidate = CountableResult & { cleanWpm: number };

/**
 * True when `candidate` sets a new best over `current` (the stored best of the same key, or `null`):
 * a counted, unflagged result whose clean WPM is a positive finite number strictly above the stored
 * one. A tie keeps the older best.
 */
export function isPersonalBest(
  candidate: BestCandidate,
  current: { cleanWpm: number } | null,
): boolean {
  if (!isCountedResult(candidate)) return false;
  if (!Number.isFinite(candidate.cleanWpm) || candidate.cleanWpm <= 0) return false;
  return current === null || candidate.cleanWpm > current.cleanWpm;
}
