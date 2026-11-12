import type { Rng } from "@fifth-copy/engine";
import { drawWords, MARKS, recipeOf, shuffled } from "./difficulty";
import type { Strategy } from "./types";
import { withSymbol } from "./transforms/include-toggles";
import {
  coreOf,
  hasAccent,
  hasPunctuation,
  hasSymbol,
  pick,
  poolOf,
  replacementTest,
  swapCore,
} from "./tokens";

/** Share of the drill's words that carry a special character (C1). */
export const SPECIAL_SHARE = 0.6;

const QUOTES = ['"', "'"] as const;

/** The token with a punctuation mark after its word, or its word in quotes. */
function withMark(token: string, rng: Rng): string {
  if (rng() < 0.7) return `${token}${pick(MARKS, rng)}`;
  const q = pick(QUOTES, rng);
  return swapCore(token, `${q}${coreOf(token)}${q}`);
}

export const isSpecial = (token: string) =>
  hasAccent(token) || hasSymbol(token) || hasPunctuation(token);

/**
 * The special-characters drill (C1): random words at the difficulty's recipe, then 60 % of the words
 * (rounded up, at shuffled slots) made special. A French slot takes an accented word of the frequency
 * list or a decoration; an English slot a decoration: a symbol of the set (`includeSymbols`) or a
 * punctuation mark or quotes (`includePunctuation`). The toggles win: an English drill with both off
 * has no special character left to draw and types plain words.
 */
export const drillStrategy: Strategy = ({ settings, rng, provider }) => {
  const { language, wordCount: target, difficulty } = settings;
  const list = provider.words(language);
  const recipe = recipeOf(difficulty);
  const punctuation = settings.includePunctuation ? recipe.punctuation : "none";
  const words = drawWords(list, target, { ...recipe, punctuation }, language, rng);

  const { key, test } = replacementTest(settings);
  const accented =
    language === "fr"
      ? poolOf({ words: list, all: list }, `drill:${key}`, (w) => test(w) && hasAccent(w))
      : [];
  const decorations = [
    ...(settings.includeSymbols ? [withSymbol] : []),
    ...(settings.includePunctuation ? [withMark] : []),
  ];
  const kinds = accented.length > 0 ? decorations.length + 1 : decorations.length;
  if (kinds === 0) return words;

  const special = Math.ceil(SPECIAL_SHARE * target);
  const have = words.filter(isSpecial).length;
  const slots = shuffled(
    words.flatMap((w, i) => (isSpecial(w) ? [] : [i])),
    rng,
  ).slice(0, Math.max(0, special - have));
  for (const i of slots) {
    const kind = Math.floor(rng() * kinds);
    words[i] =
      kind === decorations.length
        ? swapCore(words[i]!, pick(accented, rng))
        : decorations[kind]!(words[i]!, rng);
  }
  return words;
};
