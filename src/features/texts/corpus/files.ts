import type { RaceLanguage } from "@fifth-copy/protocol";
import type { SeedSentence, TextProvider } from "../generate/types";
import { CONTENT_FILES } from "./manifest";
import { contentFileSchema, issuesOf, wordListSchema, type ContentFile } from "./schema";
import EN_WORDS from "./words/en.json";
import FR_WORDS from "./words/fr.json";

/**
 * The default `TextProvider` (#351): the attributed content files `content/{fr,en}/*.json` (listed by the
 * generated `manifest.ts`) and the frequency lists `words/{fr,en}.json`, each parsed once with
 * `schema.ts`. Pure: the JSON is bundled, no file system at runtime.
 */

/** Parses one raw content file; throws naming the file and its issues. */
export function parseContentFile(name: string, raw: unknown): ContentFile {
  const parsed = contentFileSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`${name}: ${issuesOf(parsed.error).join("; ")}`);
  if (!name.startsWith(`${parsed.data.language}/`))
    throw new Error(`${name}: language "${parsed.data.language}" outside its folder`);
  return parsed.data;
}

const cache = new Map<string, unknown>();
function once<T>(key: string, make: () => T): T {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key) as T;
}

/** Every passage of a language, with the source of its file. */
export function passagesOf(language: RaceLanguage): readonly SeedSentence[] {
  return once(`passages:${language}`, () =>
    CONTENT_FILES.filter(([name]) => name.startsWith(`${language}/`)).flatMap(([name, raw]) => {
      const file = parseContentFile(name, raw);
      return file.passages.map((text) => ({ text, source: file.source }));
    }),
  );
}

const WORD_FILES: Record<RaceLanguage, unknown> = { en: EN_WORDS, fr: FR_WORDS };

/** The frequency list of a language, most frequent first. */
export function wordsOf(language: RaceLanguage): readonly string[] {
  return once(`words:${language}`, () => {
    const parsed = wordListSchema.safeParse(WORD_FILES[language]);
    if (!parsed.success) throw new Error(`words/${language}.json: ${issuesOf(parsed.error)[0]}`);
    return parsed.data.words;
  });
}

export const fileProvider: TextProvider = {
  sourceRef: (language) => `files:${language}:v1`,
  sentences: passagesOf,
  words: wordsOf,
};
