// Name screening (card #42): decides whether a short text is acceptable as a
// name. Single implementation for sign-up, guest names, bot names and generated
// race words; consumers import `isClean` from `@/features/texts`. Pure, no IO.
//
// Matching works on the run-preserving canonical form (normalize.ts). An entry
// matches a text when both collapse to the same letters and every letter run in
// the text is at least as long as in the entry: "fuuuck" matches "fuck", but
// "Bob" does not match "boob" and "Niger" does not match its slur.
import type { Entry } from "./lists/entry";
import { EN } from "./lists/en";
import { FR } from "./lists/fr";
import { normalizeRuns } from "./normalize";

type Runs = { readonly key: string; readonly counts: readonly number[] };

function runs(form: string): Runs {
  const counts: number[] = [];
  let key = "";
  for (let i = 0; i < form.length; i++) {
    if (i > 0 && form[i] === form[i - 1]) counts[counts.length - 1]! += 1;
    else {
      key += form[i];
      counts.push(1);
    }
  }
  return { key, counts };
}

// "otter" -> "o+t{2,}e+r+": the same letters, each run at least as long.
const runPattern = (form: string): string => {
  const { key, counts } = runs(form);
  return [...key].map((c, i) => (counts[i] === 1 ? `${c}+` : `${c}{${counts[i]},}`)).join("");
};

type Embedded = { readonly key: string; readonly pattern: RegExp };

// Index of a two-letter prefix (a-z only after normalization).
const bigram = (key: string, i: number): number =>
  (key.charCodeAt(i) - 97) * 26 + (key.charCodeAt(i + 1) - 97);

function compile(entries: readonly Entry[]) {
  const whole = new Map<string, (readonly number[])[]>();
  // Embedded entries indexed by their first two collapsed letters.
  const inner: Embedded[][] = Array.from({ length: 26 * 26 }, () => []);
  for (const entry of entries) {
    const form = normalizeRuns(entry.word);
    const { key, counts } = runs(form);
    if (entry.embedded) {
      if (key.length < 2) throw new Error(`embedded entry too short: ${entry.word}`);
      inner[bigram(key, 0)]!.push({ key, pattern: new RegExp(runPattern(form)) });
    } else if (key) {
      whole.set(key, [...(whole.get(key) ?? []), counts]);
    }
  }
  return { whole, inner };
}

const LISTS = compile([...FR, ...EN]);

function matchesWhole({ key, counts }: Runs): boolean {
  const candidates = LISTS.whole.get(key);
  return !!candidates && candidates.some((min) => min.every((n, i) => counts[i]! >= n));
}

// Containing the collapsed key is a cheap necessary condition; the run
// pattern then checks run lengths on the run-preserving form.
function containsEmbedded(form: string, { key }: Runs): boolean {
  for (let i = 0; i < key.length - 1; i++) {
    for (const e of LISTS.inner[bigram(key, i)]!) {
      if (key.startsWith(e.key, i) && e.pattern.test(form)) return true;
    }
  }
  return false;
}

// Tokens: split on anything that is not a letter, digit or leet symbol, and on
// camelCase boundaries ("ShitHead" -> "Shit", "Head").
const TOKEN_BOUNDARY = /[^\p{L}\p{M}\p{N}@$]+|(?<=\p{Ll})(?=\p{Lu})/u;

/** True when the text contains no banned FR/EN entry (whole token, joined text or embedded). */
export function isClean(text: string): boolean {
  // Boundary characters are dropped by normalization anyway, so the joined
  // form is the concatenation of the normalized tokens.
  const tokens = text.split(TOKEN_BOUNDARY).map(normalizeRuns);
  const joined = tokens.join("");
  if (!joined) return true;
  const joinedRuns = runs(joined);
  if (matchesWhole(joinedRuns) || containsEmbedded(joined, joinedRuns)) return false;
  if (tokens.length === 1) return true;
  return !tokens.some((token) => token && matchesWhole(runs(token)));
}
