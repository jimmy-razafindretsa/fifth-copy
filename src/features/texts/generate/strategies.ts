import { normalizeTypeable, wordCount, type Rng } from "@fifth-copy/engine";
import type { RaceSettings, TextType } from "@fifth-copy/protocol";
import { drawWords, MIN_BAND_PASSAGES, passagesFor, recipeOf, shuffled } from "./difficulty";
import { drillStrategy } from "./drill";
import { accentRatio } from "./transforms/accents";
import { letterDensity, practiceLettersOf } from "./transforms/practice-letters";
import type { SeedSentence, Strategy } from "./types";

export type { Strategy, StrategyInput } from "./types";

/** Leading tokens of a normalised text holding exactly `target` words (engine count). */
export function firstWords(tokens: readonly string[], target: number): string[] {
  const kept: string[] = [];
  let count = 0;
  for (const token of tokens) {
    if (count === target) break;
    kept.push(token);
    count += wordCount(token);
  }
  return kept;
}

/** Passages in an rng order, the whole pool reshuffled each time it runs out, until `target` words. */
function passageTokens(passages: readonly SeedSentence[], target: number, rng: Rng): string[] {
  const tokens: string[] = [];
  let count = 0;
  while (count < target) {
    for (const { text } of shuffled(passages, rng)) {
      for (const token of normalizeTypeable(text).split(" ")) {
        tokens.push(token);
        count += wordCount(token);
      }
      if (count >= target) break;
    }
  }
  return tokens;
}

/**
 * The top band of `passages` by `score`: the best third, at least `MIN_BAND_PASSAGES` (all of them
 * when there are fewer). Ties keep the corpus order.
 */
export function topBand<T extends { text: string }>(
  passages: readonly T[],
  score: (text: string) => number,
): readonly T[] {
  if (passages.length <= MIN_BAND_PASSAGES) return passages;
  const size = Math.max(MIN_BAND_PASSAGES, Math.ceil(passages.length / 3));
  return passages
    .map((p, i) => ({ p, i, s: score(p.text) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, size)
    .map(({ p }) => p);
}

/**
 * The passages a real-sentences text draws from: the difficulty's band (#351 C6), then for a French
 * race with `accentEveryWord` its top band by accented-word ratio (best-effort, #354 Q24), then with
 * practice letters its top band by their density (C2).
 */
export function sentencePassages<T extends { text: string }>(
  passages: readonly T[],
  settings: RaceSettings,
): readonly T[] {
  let pool = passagesFor(passages, settings.difficulty, settings.language);
  if (settings.language === "fr" && settings.accentEveryWord) pool = topBand(pool, accentRatio);
  const letters = practiceLettersOf(settings);
  if (letters.length > 0) pool = topBand(pool, (t) => letterDensity(t, letters));
  return pool;
}

/** Real sentences: passages of `sentencePassages`, in a random order, cut at a word boundary. */
export const sentenceStrategy: Strategy = ({ settings, rng, provider }) => {
  const passages = sentencePassages(provider.sentences(settings.language), settings);
  return firstWords(passageTokens(passages, settings.wordCount, rng), settings.wordCount);
};

/** Random words from the frequency list, following the difficulty's recipe (#351 C5). */
export const wordStrategy: Strategy = ({ settings, rng, provider }) => {
  const { language, wordCount: target, difficulty } = settings;
  const recipe = recipeOf(difficulty);
  // `includePunctuation: false`: random words never add a mark (C4)
  const punctuation = settings.includePunctuation ? recipe.punctuation : "none";
  return drawWords(provider.words(language), target, { ...recipe, punctuation }, language, rng);
};

/** One strategy per text type. */
export const STRATEGIES: Readonly<Record<TextType, Strategy>> = {
  sentences: sentenceStrategy,
  words: wordStrategy,
  "special-characters": drillStrategy,
};
