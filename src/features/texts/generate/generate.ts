import { normalizeTypeable, wordCount, type Rng } from "@fifth-copy/engine";
import type { RaceSettings } from "@fifth-copy/protocol";
import { SEED_EN } from "./seed-en";
import { SEED_FR } from "./seed-fr";
import type { GeneratedText, SeedSentence, TextProvider } from "./types";

/** The committed public-domain seed (#199): `seed-fr.ts`, `seed-en.ts`. */
export const seedProvider: TextProvider = {
  sourceRef: (language) => `seed:${language}:v1`,
  sentences: (language) => (language === "fr" ? SEED_FR : SEED_EN),
};

/** Fisher-Yates over a copy, driven by the injected rng. */
function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

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

/** Sentences in an rng order, the whole seed reshuffled each time it runs out, until `target` words. */
function sentenceTokens(sentences: readonly SeedSentence[], target: number, rng: Rng): string[] {
  const tokens: string[] = [];
  let count = 0;
  while (count < target) {
    for (const { text } of shuffled(sentences, rng)) {
      for (const token of normalizeTypeable(text).split(" ")) {
        tokens.push(token);
        count += wordCount(token);
      }
      if (count >= target) break;
    }
  }
  return tokens;
}

/** The seed's distinct words, lower-cased, without leading or trailing punctuation. */
function vocabulary(sentences: readonly SeedSentence[]): string[] {
  const words = new Set<string>();
  for (const { text } of sentences) {
    for (const token of normalizeTypeable(text).split(" ")) {
      const word = token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").toLocaleLowerCase();
      if (wordCount(word) === 1 && normalizeTypeable(word) === word) words.add(word);
    }
  }
  return [...words].sort();
}

/**
 * Builds one race text from the host's settings (ADR 0006 point 6, ARCHITECTURE 8.2): exactly
 * `settings.wordCount` words (engine `wordCount`), passed through the engine's `normalizeTypeable`,
 * in `settings.language`. Pure: same settings and `rng`, same text.
 *
 * - `sentences`: whole sentences in a random order, trimmed at a word boundary.
 * - `words`: words drawn from the provider's vocabulary.
 * - `special-characters`: falls back to `sentences` until the drill of #354.
 *
 * Accepted and ignored by the seed provider: `difficulty`, `practiceLetters`, `accentEveryWord`
 * and the include toggles (#351, #354 implement them behind the same signature).
 * The default rng is `Math.random`: picking a text is not a secret.
 */
export function generateRaceText(
  settings: Pick<RaceSettings, "language" | "textType" | "wordCount">,
  { rng = Math.random, provider = seedProvider }: { rng?: Rng; provider?: TextProvider } = {},
): GeneratedText {
  const { language, wordCount: target } = settings;
  const sentences = provider.sentences(language);
  let content: string;
  if (settings.textType === "words") {
    const words = vocabulary(sentences);
    content = Array.from({ length: target }, () => words[Math.floor(rng() * words.length)]).join(
      " ",
    );
  } else {
    content = firstWords(sentenceTokens(sentences, target, rng), target);
  }
  content = normalizeTypeable(content);
  return {
    content,
    language,
    wordCount: wordCount(content),
    sourceRef: provider.sourceRef(language),
  };
}
