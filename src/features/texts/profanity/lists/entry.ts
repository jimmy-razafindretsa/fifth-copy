// One banned entry. Matches as a whole token unless `embedded: true`, in which
// case it also matches inside a longer word. Only long, unambiguous words are
// embedded, so "Scunthorpe"-style names pass. Multi-word entries are written
// with `_`; normalization removes separators, so they match the joined name.
export type Entry = { readonly word: string; readonly embedded?: true };

const split = (words: string): string[] => words.split(/\s+/).filter(Boolean);

/** Whitespace-separated words that match only as a whole token. */
export const whole = (words: string): Entry[] => split(words).map((word) => ({ word }));

/** Whitespace-separated words that also match inside a longer word. */
export const embedded = (words: string): Entry[] =>
  split(words).map((word) => ({ word, embedded: true }));
