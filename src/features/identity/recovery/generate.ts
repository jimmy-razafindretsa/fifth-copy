import { RECOVERY_WORDS } from "./wordlist";

// The one-time recovery code (#46 C1, ADR 0009): 10 words drawn uniformly from the 2048-word bilingual
// list with `crypto.getRandomValues` (11 bits each, 110 bits drawn). Pure: the action stores only the
// Argon2id hash of `canonicalRecoveryCode(words)`; the plaintext is returned once and never logged.

export const RECOVERY_CODE_WORDS = 10;
/** 2^11: an 11-bit mask over a uniform 32-bit value is itself uniform (no modulo bias). */
const WORD_MASK = 0x7ff;

/** Lower case, accents dropped, letters only: `"Écureuil"` -> `"ecureuil"`. */
export function normalizeRecoveryWord(word: string): string {
  return word
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

const KNOWN = new Set(RECOVERY_WORDS.map(normalizeRecoveryWord));

/** A fresh code: 10 words of the list, in draw order (the display form). */
export function generateRecoveryCode(
  random: (buf: Uint32Array) => Uint32Array = (buf) => crypto.getRandomValues(buf),
): string[] {
  const draws = random(new Uint32Array(RECOVERY_CODE_WORDS));
  return Array.from(draws, (n) => RECOVERY_WORDS[n & WORD_MASK]!);
}

/**
 * The form that is hashed and compared: the words normalized and sorted, joined by one space, so the
 * order, the case and the accents of what the user types do not matter (#46 C3). Null when the input
 * is not exactly 10 words of the list (a field error: nothing is compared).
 */
export function canonicalRecoveryCode(input: string | readonly string[]): string | null {
  const raw = typeof input === "string" ? input.split(/[\s,;·.\-]+/) : [...input];
  const words = raw.map(normalizeRecoveryWord).filter((w) => w !== "");
  if (words.length !== RECOVERY_CODE_WORDS || !words.every((w) => KNOWN.has(w))) return null;
  return words.sort().join(" ");
}
