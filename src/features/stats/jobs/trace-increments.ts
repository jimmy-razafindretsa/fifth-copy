import { type KeyCounts, keyStats, type KeyStatsInput } from "@fifth-copy/engine";

/**
 * What one trace adds to the per-key daily rows (#314, ADR 0024): the engine's `keyStats` tally of
 * the trace on the desk's effective text, keyed as `prisma/schema/stats.prisma` keys the rows. The
 * single extension point of the rollup: a new dimension changes this function only. Pure.
 */
export type Increment = {
  readonly hits: number;
  readonly errors: number;
  readonly timedHits: number;
  readonly totalMs: number;
};
export type CharIncrement = Increment & { readonly char: string };
export type PairIncrement = Increment & { readonly pair: string };
export type TraceIncrements = {
  readonly chars: CharIncrement[];
  readonly pairs: PairIncrement[];
};

const LETTER = /^\p{L}$/u;

/** One expected character as a row key: lower case, NFC; kept as is when lowering is not one character. */
export function rowChar(c: string): string {
  const lower = c.toLowerCase().normalize("NFC");
  return [...lower].length === 1 ? lower : c;
}

type Sum = { hits: number; errors: number; timedHits: number; totalMs: number };

function add(map: Map<string, Sum>, key: string, c: KeyCounts) {
  const s = map.get(key) ?? { hits: 0, errors: 0, timedHits: 0, totalMs: 0 };
  s.hits += c.attempts;
  s.errors += c.errors;
  s.timedHits += c.timedHits;
  s.totalMs += c.totalMs;
  map.set(key, s);
}

/**
 * Every expected character (letters, digits, punctuation, the space), lower-cased so `E` and `e` are
 * one row; and every pair of two letters (Unicode letters, lower-cased), no other pair. Keys never
 * pressed for are absent.
 */
export function traceIncrements(input: KeyStatsInput): TraceIncrements {
  const stats = keyStats(input);
  const chars = new Map<string, Sum>();
  for (const c of stats.chars) add(chars, rowChar(c.char), c);
  const pairs = new Map<string, Sum>();
  for (const p of stats.pairs) {
    const [a, b] = [rowChar(p.pair[0] ?? ""), rowChar(p.pair[1] ?? "")];
    if (LETTER.test(a) && LETTER.test(b)) add(pairs, a + b, p);
  }
  return {
    chars: [...chars].filter(([, s]) => s.hits > 0).map(([char, s]) => ({ char, ...s })),
    pairs: [...pairs].filter(([, s]) => s.hits > 0).map(([pair, s]) => ({ pair, ...s })),
  };
}
