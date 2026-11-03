import { normalizeTypeable, wordCount } from "@fifth-copy/engine";
import { raceLanguageSchema } from "@fifth-copy/protocol";
import { z } from "zod";
import { isClean } from "../profanity/is-clean";

/**
 * The corpus file formats (#351): the single definition, read by `files.ts`, `content.test.ts`,
 * `words.test.ts` and the curators of #342 and #346. Content files live in `content/{fr,en}/*.json`
 * (one file per work), frequency lists in `words/{fr,en}.json`.
 */

/** Engine words in one passage (ADR 0007 `wordCount`). */
export const PASSAGE_WORDS = { min: 12, max: 80 } as const;

const required = (what: string) => z.string().trim().min(1, `${what} is required`);

/** A reviewed date (`YYYY-MM-DD`) or `null` before review. */
const reviewedSchema = z.iso.date().nullable();

/** Why a passage is refused, or `null`: one rule list for the schema and the content test. */
export function passageProblem(text: string): string | null {
  const n = wordCount(text);
  if (n < PASSAGE_WORDS.min || n > PASSAGE_WORDS.max)
    return `has ${n} words (${PASSAGE_WORDS.min} to ${PASSAGE_WORDS.max})`;
  if (text.normalize("NFC") !== text || normalizeTypeable(text) !== text)
    return "is not typeable as written (normalizeTypeable would change it)";
  if (!isClean(text)) return "is refused by isClean";
  return null;
}

/** Why a frequency-list word is refused, or `null`. */
export function wordProblem(word: string): string | null {
  if (word !== word.toLocaleLowerCase()) return "is not lower-case";
  if (wordCount(word) !== 1 || !/^[\p{L}']+$/u.test(word)) return "is not one word of letters";
  if (normalizeTypeable(word) !== word) return "is not typeable as written";
  if (!isClean(word)) return "is refused by isClean";
  return null;
}

const passageSchema = z.string().superRefine((text, ctx) => {
  const problem = passageProblem(text);
  if (problem) ctx.addIssue({ code: "custom", message: `passage "${text}" ${problem}` });
});

/** One work: its attributed, licence-checked passages. */
export const contentFileSchema = z.strictObject({
  language: raceLanguageSchema,
  /** `<author, title (year)>` */
  source: required("source"),
  /** `public domain`, a CC licence, or `teacher-written` */
  licence: required("licence"),
  authorType: z.enum(["public-domain", "teacher"]),
  reviewed: reviewedSchema,
  passages: z.array(passageSchema).min(1),
});
export type ContentFile = z.infer<typeof contentFileSchema>;

const wordSchema = z.string().superRefine((word, ctx) => {
  const problem = wordProblem(word);
  if (problem) ctx.addIssue({ code: "custom", message: `word "${word}" ${problem}` });
});

/** A frequency list: words ordered by descending frequency, each once. */
export const wordListSchema = z.strictObject({
  language: raceLanguageSchema,
  source: required("source"),
  licence: required("licence"),
  reviewed: reviewedSchema,
  words: z
    .array(wordSchema)
    .min(1)
    .refine((words) => new Set(words).size === words.length, "words are distinct"),
});
export type WordList = z.infer<typeof wordListSchema>;

/** The issues of a parsed file as `<path>: <message>` lines (for the content tests' failures). */
export function issuesOf(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.join(".") || "(file)"}: ${i.message}`);
}
