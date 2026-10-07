/**
 * Text normalisation to the typeable whitelist (spec 4.1, 15; ADR 0007).
 *
 * One char map and one whitelist serve both the race text (`normalizeTypeable`) and a single
 * keystroke (`normalizeKey`, same mapping without whitespace collapse or trim).
 * Every whitelisted character is one BMP code point that NFC leaves unchanged, so after
 * normalisation `text[i]` is the i-th character (one code point == one UTF-16 unit).
 */

const ASCII_PRINTABLE = Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) =>
  String.fromCharCode(0x20 + i),
);
const FRENCH_LOWER = [..."àâæçèéêëîïôùûüÿœ"];
const FRENCH_UPPER = [..."ÀÂÆÇÈÉÊËÎÏÔÙÛÜŸŒ"];

/** Every character a player can be asked to type: printable ASCII (incl. space) and French letters. */
export const TYPEABLE: readonly string[] = Object.freeze([
  ...ASCII_PRINTABLE,
  ...FRENCH_LOWER,
  ...FRENCH_UPPER,
]);

const TYPEABLE_SET: ReadonlySet<string> = new Set(TYPEABLE);

/** True when `ch` is exactly one whitelisted character. */
export function isTypeable(ch: string): boolean {
  return TYPEABLE_SET.has(ch);
}

/** Look-alikes mapped to their keyboard form (applied after NFC). */
const CHAR_MAP: ReadonlyMap<string, string> = new Map([
  // double quotes, guillemets
  ...[..."“”„‟″«»"].map((c) => [c, '"'] as const),
  // apostrophes, single quotes
  ...[..."‘’‚‛′ʼ‹›"].map((c) => [c, "'"] as const),
  // hyphens, dashes, minus
  ...[..."‐‑‒–—―−"].map((c) => [c, "-"] as const),
  ["…", "..."],
]);

/** Whitespace of any kind (incl. NBSP U+00A0, narrow NBSP U+202F, thin spaces, tabs, newlines). */
const WHITESPACE = /\s/u;

/** NFC, then each code point mapped to typeable form: whitespace -> " ", look-alikes mapped, rest dropped. */
function mapChars(s: string): string {
  let out = "";
  for (const ch of s.normalize("NFC")) {
    if (TYPEABLE_SET.has(ch)) out += ch;
    else if (WHITESPACE.test(ch)) out += " ";
    else out += CHAR_MAP.get(ch) ?? "";
  }
  return out;
}

/**
 * Normalises a race text: NFC, look-alike mapping (curly quotes, guillemets, dashes, ellipsis),
 * any whitespace to one plain space, everything outside the whitelist dropped, runs of spaces
 * collapsed, trimmed. Idempotent.
 */
export function normalizeTypeable(s: string): string {
  return mapChars(s).replace(/ {2,}/g, " ").trim();
}

/**
 * Normalises one keystroke's `key` with the same table, without collapse or trim (a typed space
 * stays " "). May return "" (not typeable) or several characters (e.g. an ellipsis).
 * "Backspace" is plain ASCII and passes through unchanged.
 */
export function normalizeKey(key: string): string {
  return mapChars(key);
}
