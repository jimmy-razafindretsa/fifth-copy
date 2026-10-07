import { normalizeTypeable } from "./normalize";

/** A word holds at least one letter or digit (a standalone "?", "!" or guillemet is not a word). */
const WORD = /[\p{L}\p{N}]/u;

/**
 * Number of words: after normalisation, tokens separated by single spaces that contain a letter
 * or digit. French typographic spacing ("Quoi ?", "« Camarade »") therefore does not inflate
 * the count.
 */
export function wordCount(s: string): number {
  const text = normalizeTypeable(s);
  if (text === "") return 0;
  return text.split(" ").filter((token) => WORD.test(token)).length;
}
