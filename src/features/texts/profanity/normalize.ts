// Canonical form for name screening (card #42, C1). Pure, no IO.
// Normalization is an ordered list of pure steps: add a step here and both
// the word lists and every checked text go through it, so matching stays
// consistent. `1` and `l` both map to `i` (one canonical letter for the
// ambiguous glyph), which is fine because lists and input share the pipeline.

type Step = (text: string) => string;

// One table for the last step: ligatures, leetspeak, and plain letters. A
// character absent from the table (separator, accent mark left by NFKD, digit
// without a leet meaning, punctuation, zero-width or other invisible) is dropped.
const CHAR_MAP: ReadonlyMap<string, string> = new Map([
  // a-z kept as is, except `l`, which shares `i` with `1`
  ..."abcdefghijkmnopqrstuvwxyz".split("").map((c): [string, string] => [c, c]),
  ["l", "i"],
  // ligatures and letters NFKD does not decompose
  ["œ", "oe"],
  ["æ", "ae"],
  ["ß", "ss"],
  ["ø", "o"],
  ["đ", "d"],
  ["ł", "i"],
  ["ı", "i"],
  // leetspeak
  ["0", "o"],
  ["1", "i"],
  ["3", "e"],
  ["4", "a"],
  ["5", "s"],
  ["7", "t"],
  ["@", "a"],
  ["$", "s"],
]);

const lowercase: Step = (s) => s.toLowerCase();
// NFKD splits accents off their letter (é -> e + U+0301, dropped by the next
// step) and folds compatibility forms (fullwidth letters, ﬁ) onto plain letters.
const decompose: Step = (s) => s.normalize("NFKD");
// ASCII fast path for the hot loop (C5); other characters go through the map.
const ASCII: readonly string[] = Array.from(
  { length: 128 },
  (_, code) => CHAR_MAP.get(String.fromCharCode(code)) ?? "",
);
const mapChars: Step = (s) => {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    out += code < 128 ? ASCII[code]! : (CHAR_MAP.get(s[i]!) ?? "");
  }
  return out;
};

export const STEPS: readonly Step[] = [lowercase, decompose, mapChars];

/** Canonical letters, repeated letters kept ("Otter" -> "otter"). */
export function normalizeRuns(text: string): string {
  let out = text;
  for (const step of STEPS) out = step(out);
  return out;
}

/** Collapses each run of the same letter to one letter. */
export function collapse(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) if (text[i] !== text[i - 1]) out += text[i];
  return out;
}

/** Fully canonical form: lowercase, no accents, leet mapped, separators removed, runs collapsed. */
export function normalize(text: string): string {
  return collapse(normalizeRuns(text));
}
