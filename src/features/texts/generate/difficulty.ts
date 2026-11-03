import { RARE_LETTERS, type Rng } from "@fifth-copy/engine";
import type { Difficulty, RaceLanguage } from "@fifth-copy/protocol";

/**
 * Difficulty as data (#351, R109-R115). `words` mode follows a `Recipe` (which part of the frequency
 * list, which words, how much punctuation); the presets are rows of the same recipe table as a custom
 * difficulty. `sentences` mode bands each passage by `passageScore` and draws from the band.
 */

export type WordLength = "short" | "medium" | "long";
export type PunctuationDensity = "none" | "light" | "heavy";

/** Letters per word of each custom word length. */
export const LENGTH_BANDS: Readonly<Record<WordLength, { min: number; max: number }>> = {
  short: { min: 1, max: 4 },
  medium: { min: 5, max: 7 },
  long: { min: 8, max: Infinity },
};

/** A test a share of the words must pass. */
export type FocusTest = WordLength | "rare" | "long-or-rare";
export type Focus = { readonly share: number; readonly test: FocusTest };

export type Recipe = {
  /** Draw from the first `top` words of the frequency list; `null`: the whole list. */
  readonly top: number | null;
  /** No word has more letters than this; `null`: no limit. */
  readonly maxLength: number | null;
  /** `exclude`: no word holds a rare letter of the language. */
  readonly rare: "exclude" | "allow";
  /** At least `share` of the words pass `test` (shares overlap: the same words serve every focus). */
  readonly focus: readonly Focus[];
  readonly punctuation: PunctuationDensity;
};

/** The preset levels as recipes (C5). */
export const PRESETS: Readonly<Record<"easy" | "normal" | "hard", Recipe>> = {
  easy: { top: 1000, maxLength: 5, rare: "exclude", focus: [], punctuation: "none" },
  normal: { top: 3000, maxLength: 9, rare: "allow", focus: [], punctuation: "light" },
  hard: {
    top: null,
    maxLength: null,
    rare: "allow",
    focus: [{ share: 0.4, test: "long-or-rare" }],
    punctuation: "heavy",
  },
};

/** Share of the words a custom recipe gives its word length and its rare letters. */
export const CUSTOM_SHARES = { wordLength: 0.7, rareLetters: 0.3 } as const;

/** The recipe of a difficulty setting: a preset row, or the custom recipe built from its fields. */
export function recipeOf(difficulty: Difficulty): Recipe {
  if (difficulty.level !== "custom") return PRESETS[difficulty.level];
  const focus: Focus[] = [{ share: CUSTOM_SHARES.wordLength, test: difficulty.wordLength }];
  if (difficulty.rareLetters) focus.push({ share: CUSTOM_SHARES.rareLetters, test: "rare" });
  return {
    top: null,
    maxLength: null,
    rare: difficulty.rareLetters ? "allow" : "exclude",
    focus,
    punctuation: difficulty.punctuationDensity,
  };
}

/** Punctuation marks appended to words (C5). */
export const MARKS = [",", ".", "!", "?", ";", ":"] as const;

/** Words between two marks: `light` one per 8 to 12 words, `heavy` one per 2 to 4. */
export const MARK_GAPS: Readonly<Record<Exclude<PunctuationDensity, "none">, [number, number]>> = {
  light: [8, 12],
  heavy: [2, 4],
};

const LETTER = /\p{L}/u;

/** Letters of a word (punctuation and apostrophes left out). */
export const lettersOf = (word: string): string[] => [...word].filter((c) => LETTER.test(c));

export const hasRareLetter = (word: string, language?: RaceLanguage): boolean => {
  const rare = RARE_LETTERS[language ?? "any"];
  return lettersOf(word.toLowerCase()).some((c) => rare.has(c));
};

export function passes(word: string, test: FocusTest, language: RaceLanguage): boolean {
  const length = lettersOf(word).length;
  if (test === "rare") return hasRareLetter(word, language);
  if (test === "long-or-rare")
    return length >= LENGTH_BANDS.long.min || hasRareLetter(word, language);
  const band = LENGTH_BANDS[test];
  return length >= band.min && length <= band.max;
}

const pick = <T>(items: readonly T[], rng: Rng): T => items[Math.floor(rng() * items.length)]!;
const between = ([min, max]: readonly [number, number], rng: Rng) =>
  min + Math.floor(rng() * (max - min + 1));

/** Fisher-Yates over a copy, driven by the injected rng. */
export function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/**
 * `count` words from a frequency list following `recipe`: the first `share * count` slots (rounded up)
 * of each focus overlap, the slots are shuffled, and each slot draws from the words passing all its
 * tests; a slot whose tests no word passes drops its last test, so a short list never fails.
 */
export function drawWords(
  list: readonly string[],
  count: number,
  recipe: Recipe,
  language: RaceLanguage,
  rng: Rng,
): string[] {
  const base0 = list
    .slice(0, recipe.top ?? list.length)
    .filter((w) => recipe.maxLength === null || lettersOf(w).length <= recipe.maxLength)
    .filter((w) => recipe.rare === "allow" || !hasRareLetter(w, language));
  const base = base0.length > 0 ? base0 : list;
  const pools = new Map<string, readonly string[]>();
  const poolOf = (tests: readonly FocusTest[]): readonly string[] => {
    for (let n = tests.length; n > 0; n--) {
      const key = tests.slice(0, n).join("+");
      if (!pools.has(key))
        pools.set(
          key,
          base.filter((w) => tests.slice(0, n).every((t) => passes(w, t, language))),
        );
      const pool = pools.get(key)!;
      if (pool.length > 0) return pool;
    }
    return base;
  };
  const slots = Array.from({ length: count }, (_, i) =>
    recipe.focus.filter((f) => i < Math.ceil(f.share * count)).map((f) => f.test),
  );
  const words: string[] = [];
  for (const tests of shuffled(slots, rng)) {
    const pool = poolOf(tests);
    let word = pick(pool, rng);
    if (word === words.at(-1) && pool.length > 1) word = pick(pool, rng);
    words.push(word);
  }
  return punctuate(words, recipe.punctuation, rng);
}

/** Appends marks after words at the density's gaps (C5). */
export function punctuate(words: readonly string[], density: PunctuationDensity, rng: Rng) {
  if (density === "none") return [...words];
  const out = [...words];
  for (let i = between(MARK_GAPS[density], rng) - 1; i < out.length;) {
    out[i] += pick(MARKS, rng);
    i += between(MARK_GAPS[density], rng);
  }
  return out;
}

// --- sentences mode (C6) ---

export type Band = "easy" | "normal" | "hard";

/** Weights of `passageScore`: letters per word, plus the rare-letter and punctuation ratios. */
export const SCORE_WEIGHTS = { rare: 4, punctuation: 3 } as const;

/**
 * Per language, `passageScore` below `easy` is easy, from `hard` up is hard, normal between (about a
 * third of each corpus per band; French words run longer).
 */
export const BAND_THRESHOLDS: Readonly<Record<RaceLanguage, { easy: number; hard: number }>> = {
  en: { easy: 4.4, hard: 5.0 },
  fr: { easy: 5.15, hard: 5.5 },
};

/** Below this many passages in a band, the generator draws from every passage. */
export const MIN_BAND_PASSAGES = 5;

const PUNCTUATION = /[^\p{L}\p{N}\s'-]/gu;

/**
 * How hard a passage is to type: average letters per word, plus `rare` times the share of words with
 * a rare letter (the language's, or both languages' without one), plus `punctuation` times the marks
 * per word.
 */
export function passageScore(text: string, language?: RaceLanguage): number {
  const words = text.split(/\s+/).filter((t) => LETTER.test(t));
  if (words.length === 0) return 0;
  const letters = words.reduce((n, w) => n + lettersOf(w).length, 0);
  const rare = words.filter((w) => hasRareLetter(w, language)).length;
  const marks = text.match(PUNCTUATION)?.length ?? 0;
  return (
    letters / words.length +
    (SCORE_WEIGHTS.rare * rare) / words.length +
    (SCORE_WEIGHTS.punctuation * marks) / words.length
  );
}

export function bandOfScore(score: number, language: RaceLanguage): Band {
  const { easy, hard } = BAND_THRESHOLDS[language];
  if (score < easy) return "easy";
  return score >= hard ? "hard" : "normal";
}

/** Letters per word, rare-word share and marks per word a custom recipe asks for. */
const RECIPE_TRAITS = {
  length: { short: 3.5, medium: 6, long: 9 },
  punctuation: { none: 0, light: 0.1, heavy: 0.3 },
} as const;

/** The band a difficulty draws passages from: the preset's own, or the nearest band to a custom recipe. */
export function bandOf(difficulty: Difficulty, language: RaceLanguage): Band {
  if (difficulty.level !== "custom") return difficulty.level;
  const score =
    RECIPE_TRAITS.length[difficulty.wordLength] +
    SCORE_WEIGHTS.rare * (difficulty.rareLetters ? CUSTOM_SHARES.rareLetters : 0) +
    SCORE_WEIGHTS.punctuation * RECIPE_TRAITS.punctuation[difficulty.punctuationDensity];
  return bandOfScore(score, language);
}

/** The passages of `difficulty`'s band, or all of them when the band holds fewer than 5. */
export function passagesFor<T extends { text: string }>(
  passages: readonly T[],
  difficulty: Difficulty,
  language: RaceLanguage,
): readonly T[] {
  const band = bandOf(difficulty, language);
  const matching = passages.filter(
    (p) => bandOfScore(passageScore(p.text, language), language) === band,
  );
  return matching.length >= MIN_BAND_PASSAGES ? matching : passages;
}
