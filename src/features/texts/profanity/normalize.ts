// Canonical form for name screening (card #42, C1). Pure, no IO.
// Normalization is an ordered list of pure steps: add a step here and both
// the word lists and every checked text go through it, so matching stays
// consistent. `1` and `l` both map to `i` (one canonical letter for the
// ambiguous glyph), which is fine because lists and input share the pipeline.

type Step = (text: string) => string;

const LIGATURES: Readonly<Record<string, string>> = {
  œ: "oe",
  æ: "ae",
  ß: "ss",
  ø: "o",
  đ: "d",
  ł: "l",
  ı: "i",
};

const LEET: Readonly<Record<string, string>> = {
  "0": "o",
  "1": "i",
  l: "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "@": "a",
  $: "s",
};

const lowercase: Step = (s) => s.toLowerCase();
// NFKD splits accents off their letter (é -> e + U+0301) and folds
// compatibility forms (fullwidth letters, ﬁ) onto plain letters.
const stripDiacritics: Step = (s) => s.normalize("NFKD").replace(/\p{M}+/gu, "");
const ligatures: Step = (s) => s.replace(/[œæßøđłı]/g, (c) => LIGATURES[c] ?? c);
const leet: Step = (s) => s.replace(/[01l3457@$]/g, (c) => LEET[c] ?? c);
// Separators, digits without a leet meaning, punctuation and invisible
// characters (zero-width, soft hyphen, BOM) all go.
const lettersOnly: Step = (s) => s.replace(/[^a-z]+/g, "");

export const STEPS: readonly Step[] = [lowercase, stripDiacritics, ligatures, leet, lettersOnly];

/** Canonical letters, repeated letters kept ("Otter" -> "otter"). */
export function normalizeRuns(text: string): string {
  let out = text;
  for (const step of STEPS) out = step(out);
  return out;
}

/** Collapses each run of the same letter to one letter. */
export function collapse(text: string): string {
  return text.replace(/(.)\1+/g, "$1");
}

/** Fully canonical form: lowercase, no accents, leet mapped, separators removed, runs collapsed. */
export function normalize(text: string): string {
  return collapse(normalizeRuns(text));
}
