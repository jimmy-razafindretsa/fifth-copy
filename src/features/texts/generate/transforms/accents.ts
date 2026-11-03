import {
  hasAccent,
  isWord,
  pick,
  poolOf,
  replacementTest,
  strictAccents,
  swapCore,
} from "../tokens";
import type { Transform } from "./types";

/**
 * Every-word accent (C3, French): under the strict rule (random words and the drill) each word without
 * an accented letter takes an accented word of the frequency list in its place, keeping its marks.
 * Real sentences are ranked by `accentRatio` in the sentence strategy instead (best-effort, #354 Q24).
 */
export const accentsTransform: Transform = (tokens, settings, rng, lists) => {
  if (!strictAccents(settings)) return [...tokens];
  const { key, test } = replacementTest(settings);
  const pool = poolOf(lists, `accents:${key}`, test);
  if (pool.length === 0) return [...tokens];
  return tokens.map((t) => (isWord(t) && !hasAccent(t) ? swapCore(t, pick(pool, rng)) : t));
};

/** Share of a passage's words holding an accented letter. */
export function accentRatio(text: string): number {
  const words = text.split(/\s+/).filter(isWord);
  return words.length === 0 ? 0 : words.filter(hasAccent).length / words.length;
}
