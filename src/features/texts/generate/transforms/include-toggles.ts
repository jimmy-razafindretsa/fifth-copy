import type { Rng } from "@fifth-copy/engine";
import {
  coreOf,
  hasDigit,
  hasPunctuation,
  hasSymbol,
  isGenerated,
  isWord,
  pick,
  poolOf,
  PUNCTUATION,
  replacementTest,
  strictAccents,
  swapCore,
  SYMBOLS,
} from "../tokens";
import type { Transform } from "./types";

/** At least one word in every block of this many holds a number (or a symbol) when the toggle is on (C4). */
export const BLOCK = 10;

const DIGITS = /\p{N}/gu;
const SYMBOL_CHARS = new RegExp(`[${SYMBOLS.map((c) => `\\${c}`).join("")}]`, "g");
const PUNCTUATION_CHARS = new RegExp(`[${PUNCTUATION.map((c) => `\\${c}`).join("")}]`, "g");

/**
 * Removes `chars` from every token. A token left with no character goes, and so does a word left with
 * no letter or digit ("1914," without digits): its stray marks would type as noise.
 */
function strip(tokens: readonly string[], chars: RegExp): string[] {
  return tokens.flatMap((t) => {
    const left = t.replace(chars, "");
    if (left === t) return [t];
    return left === "" || (isWord(t) && !isWord(left)) ? [] : [left];
  });
}

/** Word positions of `tokens` split in blocks of `BLOCK`; a block lacking `has` gets `add` once. */
function everyBlock(
  tokens: readonly string[],
  rng: Rng,
  has: (t: string) => boolean,
  add: (t: string) => string,
): string[] {
  const out = [...tokens];
  const positions = out.flatMap((t, i) => (isWord(t) ? [i] : []));
  for (let b = 0; b < positions.length; b += BLOCK) {
    const block = positions.slice(b, b + BLOCK);
    if (block.some((i) => has(out[i]!))) continue;
    const i = pick(block, rng);
    out[i] = add(out[i]!);
  }
  return out;
}

/** A number of 1 to 4 digits. */
export function numberOf(rng: Rng): string {
  const digits = 1 + Math.floor(rng() * 4);
  const n = Math.floor(rng() * 10 ** digits);
  return String(n);
}

/**
 * `includePunctuation` (C4). Off: sentences lose their marks; random words and the drill never add
 * any (a list word holding an apostrophe gives way to one without). On: unchanged.
 */
export const punctuationTransform: Transform = (tokens, settings, rng, lists) => {
  if (settings.includePunctuation) return [...tokens];
  if (!isGenerated(settings)) return strip(tokens, PUNCTUATION_CHARS);
  const { key, test } = replacementTest(settings);
  const pool = poolOf(lists, `punctuation:${key}`, test);
  const swapped = tokens.map((t) =>
    hasPunctuation(coreOf(t)) && pool.length > 0 ? swapCore(t, pick(pool, rng)) : t,
  );
  return strip(swapped, PUNCTUATION_CHARS);
};

/**
 * `includeNumbers` (C4). Off: no digit (a word made only of digits goes). On, in random words and the
 * drill: a word in every block of 10 becomes a number, or under the strict French accent rule takes
 * one after a hyphen ("été-12") so that every word keeps its accent.
 */
export const numbersTransform: Transform = (tokens, settings, rng) => {
  if (!settings.includeNumbers) return strip(tokens, DIGITS);
  if (!isGenerated(settings)) return [...tokens];
  const glue = strictAccents(settings);
  return everyBlock(tokens, rng, hasDigit, (t) =>
    glue ? swapCore(t, `${coreOf(t)}-${numberOf(rng)}`) : swapCore(t, numberOf(rng)),
  );
};

/** Symbols that open a word, close it, or wrap it (C1, C4). */
const BEFORE = [..."#@$~\\"];
const AFTER = [..."%*+=&/_|"];
const WRAPS = ["()", "[]", "{}", "<>"] as const;

/** The token with one symbol of the set added before, after or around its word core. */
export function withSymbol(token: string, rng: Rng): string {
  const core = coreOf(token);
  const r = rng();
  if (r < 0.3) return swapCore(token, `${pick(BEFORE, rng)}${core}`);
  if (r < 0.6) return swapCore(token, `${core}${pick(AFTER, rng)}`);
  const [open, close] = [...pick(WRAPS, rng)];
  return swapCore(token, `${open}${core}${close}`);
}

/**
 * `includeSymbols` (C4). Off: no character of the symbol set. On, in random words and the drill: a word
 * in every block of 10 carries a symbol.
 */
export const symbolsTransform: Transform = (tokens, settings, rng) => {
  if (!settings.includeSymbols) return strip(tokens, SYMBOL_CHARS);
  if (!isGenerated(settings)) return [...tokens];
  return everyBlock(tokens, rng, hasSymbol, (t) => withSymbol(t, rng));
};
