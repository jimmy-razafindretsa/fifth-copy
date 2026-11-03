import { normalizeTypeable, wordCount, type Rng } from "@fifth-copy/engine";
import type { RaceSettings, TextType } from "@fifth-copy/protocol";
import { drawWords, passagesFor, recipeOf, shuffled } from "./difficulty";
import type { SeedSentence, TextProvider } from "./types";

/** What a strategy gets: the host's settings, the injected rng and the text source. */
export type StrategyInput = {
  settings: Pick<RaceSettings, "language" | "wordCount" | "difficulty">;
  rng: Rng;
  provider: TextProvider;
};

/** Turns settings into one text of exactly `settings.wordCount` engine words, typeable as written. */
export type Strategy = (input: StrategyInput) => string;

/** Keeps leading tokens of a normalised text until it holds exactly `target` words (engine count). */
function firstWords(tokens: readonly string[], target: number): string {
  const kept: string[] = [];
  let count = 0;
  for (const token of tokens) {
    if (count === target) break;
    kept.push(token);
    count += wordCount(token);
  }
  return kept.join(" ");
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

/** Real sentences: passages of the difficulty's band (C6), in a random order, cut at a word boundary. */
export const sentenceStrategy: Strategy = ({ settings, rng, provider }) => {
  const { language, wordCount: target, difficulty } = settings;
  const passages = passagesFor(provider.sentences(language), difficulty, language);
  return firstWords(passageTokens(passages, target, rng), target);
};

/** Random words from the frequency list, following the difficulty's recipe (C5). */
export const wordStrategy: Strategy = ({ settings, rng, provider }) => {
  const { language, wordCount: target, difficulty } = settings;
  return drawWords(provider.words(language), target, recipeOf(difficulty), language, rng).join(" ");
};

/** One strategy per text type: the extension point of #354 (drills and character controls). */
export const STRATEGIES: Readonly<Record<TextType, Strategy>> = {
  sentences: sentenceStrategy,
  words: wordStrategy,
  // The special-characters drill is #354; until then it types real sentences.
  "special-characters": sentenceStrategy,
};
