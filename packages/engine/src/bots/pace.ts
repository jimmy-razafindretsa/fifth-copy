import type { Rng } from "../types";
import type { BotLanguage } from "./types";

/**
 * Burst and pause (#361, R123): how fast a bot types the word around a position, relative to its
 * mean. Common short words go in a burst, long words and words with a rare letter slow it down.
 */

/**
 * Letters rare enough on the keyboard of each language to slow a typist (C3). The one rare-letter list
 * (ADR 0007): the text generator's difficulty (#351) reads it through the engine index.
 */
export const RARE_LETTERS: Readonly<Record<BotLanguage | "any", ReadonlySet<string>>> = {
  fr: new Set([..."kwxyz"]),
  en: new Set([..."jqxz"]),
  any: new Set([..."jkqwxyz"]),
};

/** Common words: at most this many letters and no rare letter. */
const SHORT_WORD = 4;
/** Slow words: at least this many letters (or a rare letter). */
const LONG_WORD = 9;
/** How far `burst` speeds up a common word and slows down a slow one. */
const BURST_FAST = 0.5;
const BURST_SLOW = 0.3;

const LETTER = /\p{L}/u;
const isLetter = (ch: string | undefined): ch is string => ch !== undefined && LETTER.test(ch);

/** The letters of the word around `i` (empty when `chars[i]` is not part of a word). */
function wordAt(chars: readonly string[], i: number): string {
  if (!isLetter(chars[i]) && !isLetter(chars[i - 1])) return "";
  let start = i;
  while (start > 0 && chars[start - 1] !== " ") start--;
  let word = "";
  for (let j = start; j < chars.length && chars[j] !== " "; j++) {
    if (isLetter(chars[j])) word += chars[j];
  }
  return word;
}

/** The pace class of a word: `fast` (common), `slow` (long or with a rare letter) or `neutral`. */
export function wordClass(word: string, language?: BotLanguage): "fast" | "neutral" | "slow" {
  if (word === "") return "neutral";
  const rare = RARE_LETTERS[language ?? "any"];
  const letters = [...word.toLowerCase()];
  if (letters.length >= LONG_WORD || letters.some((c) => rare.has(c))) return "slow";
  return letters.length <= SHORT_WORD ? "fast" : "neutral";
}

/** Delay multiplier of position `i`: below 1 in a burst, above 1 on a slow word, 1 elsewhere. */
export function paceFactor(
  chars: readonly string[],
  i: number,
  burst: number,
  language?: BotLanguage,
): number {
  switch (wordClass(wordAt(chars, i), language)) {
    case "fast":
      return 1 - BURST_FAST * burst;
    case "slow":
      return 1 + BURST_SLOW * burst;
    default:
      return 1;
  }
}

/**
 * Mean-one jitter around 1: lognormal `exp(sigma * z - sigma^2 / 2)`, `z` a standard normal from
 * two `rng()` draws (Box-Muller). A float, never rounded, so no two delays are equal by design.
 */
export function jitter(rng: Rng, sigma: number): number {
  const u = 1 - rng(); // (0, 1]: log(u) is finite
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
  return Math.exp(sigma * z - (sigma * sigma) / 2);
}
