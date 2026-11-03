import { normalizeTypeable, wordCount, type Rng } from "@fifth-copy/engine";
import type { RaceSettings } from "@fifth-copy/protocol";
import { fileProvider } from "../corpus/files";
import { baseOf, recipeOf } from "./difficulty";
import { firstWords, STRATEGIES } from "./strategies";
import { countWords, type Lists } from "./tokens";
import { TRANSFORMS } from "./transforms";
import { profanityTransform } from "./transforms/profanity-pass";
import type { GeneratedText, TextProvider } from "./types";

/** Batches the count fix-up adds before it gives up (a provider with almost no clean word). */
export const MAX_REFILLS = 5;

/**
 * Builds one race text from the host's settings (ADR 0006 point 6, ARCHITECTURE 8.2): exactly
 * `settings.wordCount` words (engine `wordCount`), passed through the engine's `normalizeTypeable`,
 * in `settings.language`, at `settings.difficulty`. Pure: same settings and `rng`, same text.
 *
 * Pipeline: the text type's strategy (`STRATEGIES`, strategies.ts) gives the tokens of exactly
 * `wordCount` words; the character-level controls (`TRANSFORMS`, #354) shape them in order, the
 * profanity pass last; the count fix-up refills words a transform dropped with a new batch through the
 * same pipeline, re-checks the joins and cuts at `wordCount`. The text comes from `provider` (default
 * `fileProvider`). The default rng is `Math.random`: picking a text is not a secret.
 */
export function generateRaceText(
  settings: RaceSettings,
  { rng = Math.random, provider = fileProvider }: { rng?: Rng; provider?: TextProvider } = {},
): GeneratedText {
  const { language, wordCount: target } = settings;
  const strategy = STRATEGIES[settings.textType];
  const all = provider.words(language);
  const lists: Lists = { words: baseOf(all, recipeOf(settings.difficulty), language), all };

  const batch = (count: number) =>
    TRANSFORMS.reduce(
      (tokens, transform) => transform(tokens, settings, rng, lists),
      strategy({ settings: { ...settings, wordCount: count }, rng, provider }),
    );

  let tokens = batch(target);
  for (let refill = 0; refill < MAX_REFILLS && countWords(tokens) < target; refill++) {
    tokens = profanityTransform(
      [...tokens, ...batch(target - countWords(tokens))],
      settings,
      rng,
      lists,
    );
  }
  const content = normalizeTypeable(firstWords(tokens, target).join(" "));
  return {
    content,
    language,
    wordCount: wordCount(content),
    sourceRef: provider.sourceRef(language),
  };
}
