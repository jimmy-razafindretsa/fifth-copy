import type { Rng } from "@fifth-copy/engine";
import type { RaceSettings } from "@fifth-copy/protocol";

/**
 * Character sets and token helpers of the character-level controls (#354). A text is shaped as a list
 * of tokens (the space-separated pieces of a normalised text); a token is a word when it holds a
 * letter or a digit (engine `wordCount`).
 */

/** The French accented letters of the every-word-accent rule (C3). */
export const ACCENTS: readonly string[] = [..."éèêëàâçîïôùûüœ"];
/** The symbol set of `includeSymbols` (C4). */
export const SYMBOLS: readonly string[] = [..."#$%&*+=@/\\()[]{}<>_|~"];
/** The punctuation marks of `includePunctuation` (C4). */
export const PUNCTUATION: readonly string[] = [...",.!?;:'\""];

const ACCENT_SET = new Set(ACCENTS);
const SYMBOL_SET = new Set(SYMBOLS);
const PUNCTUATION_SET = new Set(PUNCTUATION);

export const hasAccent = (token: string) => [...token.toLowerCase()].some((c) => ACCENT_SET.has(c));
export const hasSymbol = (token: string) => [...token].some((c) => SYMBOL_SET.has(c));
export const hasPunctuation = (token: string) => [...token].some((c) => PUNCTUATION_SET.has(c));
export const hasDigit = (token: string) => /\p{N}/u.test(token);
const WORD = /[\p{L}\p{N}]/u;
/** A normalised token is a word when it holds a letter or a digit (engine `wordCount`, without its normalisation). */
export const isWord = (token: string) => WORD.test(token);

/** Engine words of a list of normalised tokens. */
export const countWords = (tokens: readonly string[]) =>
  tokens.reduce((n, t) => n + (isWord(t) ? 1 : 0), 0);

/** A generated text (random words or the drill), as opposed to real sentences. */
export const isGenerated = (settings: Pick<RaceSettings, "textType">) =>
  settings.textType !== "sentences";

/** The strict every-word-accent rule is on: French, `accentEveryWord`, a generated text (C3). */
export const strictAccents = (
  settings: Pick<RaceSettings, "language" | "accentEveryWord" | "textType">,
) => settings.language === "fr" && settings.accentEveryWord && isGenerated(settings);

export const pick = <T>(items: readonly T[], rng: Rng): T =>
  items[Math.floor(rng() * items.length)]!;

/** The word core of a token: its first run of letters and digits (apostrophes and hyphens inside). */
const CORE = /[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/u;

/** The token with its word core replaced by `word`, keeping the marks and symbols around it. */
export function swapCore(token: string, word: string): string {
  return CORE.test(token) ? token.replace(CORE, () => word) : word;
}

/** The word core of a token ("" when it holds no letter or digit). */
export const coreOf = (token: string) => token.match(CORE)?.[0] ?? "";

/** What the transforms draw replacement words from. */
export type Lists = {
  /** The frequency-list words the strategy draws from at this difficulty. */
  readonly words: readonly string[];
  /** The whole frequency list of the language, the fallback when `words` holds no fitting word. */
  readonly all: readonly string[];
};

const pools = new WeakMap<readonly string[], Map<string, readonly string[]>>();

/** The words of `lists` passing `test` (cached per list and key), from `words` first, then `all`. */
export function poolOf(lists: Lists, key: string, test: (w: string) => boolean): readonly string[] {
  for (const list of [lists.words, lists.all]) {
    let byKey = pools.get(list);
    if (!byKey) pools.set(list, (byKey = new Map()));
    let pool = byKey.get(key);
    if (!pool) byKey.set(key, (pool = list.filter(test)));
    if (pool.length > 0) return pool;
  }
  return [];
}

/**
 * The test every replacement word passes under `settings`: an accent under the strict rule, no
 * apostrophe or quote when punctuation is off, and a key naming the combination for `poolOf`.
 */
export function replacementTest(settings: RaceSettings): {
  key: string;
  test: (w: string) => boolean;
} {
  const accent = strictAccents(settings);
  const marks = settings.includePunctuation;
  return {
    key: `${accent ? "a" : ""}${marks ? "" : "p"}`,
    test: (w) => (!accent || hasAccent(w)) && (marks || !hasPunctuation(w)),
  };
}
