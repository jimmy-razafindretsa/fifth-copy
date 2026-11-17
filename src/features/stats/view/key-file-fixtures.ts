import { addDays } from "@/lib/time";
import { type CharStatRow, type KeyFile, keyFileOf, type PairStatRow } from "./key-file";

/**
 * Key file fixtures (#961 C6) for `/design` and the component tests of the per-key sections: built by
 * `keyFileOf` from synthetic daily rows, so they always follow its rules. No real typist's data;
 * deterministic (no clock, no randomness).
 */

const FIRST_DAY = "2026-10-20";

/** A deterministic wobble in [-1, 1] for day `i` of key `k`. */
const wobble = (i: number, k: number) => (((i * 7 + k * 13) % 9) - 4) / 4;

/** Relative frequency of each key in French prose (rough, for display). */
const FREQUENCY: Record<string, number> = {
  e: 14,
  a: 8,
  s: 8,
  i: 7,
  t: 7,
  n: 7,
  r: 6,
  u: 6,
  l: 5,
  o: 5,
  d: 4,
  c: 3,
  m: 3,
  p: 3,
  é: 2,
  v: 2,
  q: 1,
  f: 1,
  b: 1,
  g: 1,
  h: 1,
  j: 1,
  à: 1,
  è: 1,
  x: 1,
  y: 1,
  ç: 1,
  z: 1,
  k: 1,
  w: 1,
  " ": 16,
  "'": 1,
  ",": 1,
  ".": 1,
};

/** One synthetic day of one character: `hits` presses, base speed `wpm`, a share of errors. */
function charRow(
  i: number,
  char: string,
  hits: number,
  wpm: number,
  errorRate: number,
): CharStatRow {
  const timedHits = Math.max(0, hits - 1);
  return {
    day: addDays(FIRST_DAY, i),
    char,
    layout: "FR_CA",
    hits,
    errors: Math.round(hits * errorRate),
    timedHits,
    totalMs: Math.round((12000 * timedHits) / wpm),
  };
}

/** `days` days of typing over `chars`: each key gains `gain` WPM a day; `slow` lags under the goal. */
function typing(days: number, chars: readonly string[], slow: string | null): CharStatRow[] {
  return Array.from({ length: days }, (_, i) =>
    chars.map((char, k) => {
      const frequency = FREQUENCY[char] ?? 1;
      const base = char === slow ? 26 : 38 + frequency;
      const wpm = base + 0.4 * i + 3 * wobble(i, k);
      const errorRate = char === slow ? 0.14 : 0.02 + 0.01 * Math.abs(wobble(i, k + 1));
      return charRow(i, char, 3 * frequency + (i % 3), wpm, errorRate);
    }),
  ).flat();
}

const pairRow = (pair: string, hits: number, errors: number, wpm: number): PairStatRow => ({
  pair,
  hits,
  errors,
  timedHits: hits,
  totalMs: Math.round((12000 * hits) / wpm),
});

const THREE_DAY_CHARS = [..."lestrionaud", " "];
const ALL_CHARS = Object.keys(FREQUENCY);

/** The rows each fixture is built from (exported so tests can check the fixtures are `keyFileOf`'s). */
export const KEY_FILE_FIXTURE_ROWS = {
  empty: { chars: [] as CharStatRow[], pairs: [] as PairStatRow[] },
  threeDays: {
    chars: typing(3, THREE_DAY_CHARS, null),
    pairs: [pairRow("es", 24, 1, 44), pairRow("le", 21, 2, 41), pairRow("ou", 12, 3, 30)],
  },
  twoWeeks: {
    // One day typed on a second layout too: the file sums layouts.
    chars: [...typing(14, ALL_CHARS, "q"), { ...charRow(13, "é", 6, 34, 0.17), layout: "CSA" }],
    pairs: [
      pairRow("qu", 64, 9, 27),
      pairRow("ét", 41, 5, 31),
      pairRow("ai", 120, 6, 46),
      pairRow("es", 180, 5, 52),
      pairRow("nt", 95, 4, 44),
      pairRow("ou", 88, 4, 40),
      pairRow("re", 150, 3, 50),
      pairRow("çà", 8, 2, 20),
    ],
  },
} as const satisfies Record<
  string,
  { chars: readonly CharStatRow[]; pairs: readonly PairStatRow[] }
>;

export type KeyFileFixture = keyof typeof KEY_FILE_FIXTURE_ROWS;

export const keyFileFixtures: Record<KeyFileFixture, KeyFile> = {
  empty: keyFileOf(KEY_FILE_FIXTURE_ROWS.empty.chars, KEY_FILE_FIXTURE_ROWS.empty.pairs),
  threeDays: keyFileOf(
    KEY_FILE_FIXTURE_ROWS.threeDays.chars,
    KEY_FILE_FIXTURE_ROWS.threeDays.pairs,
  ),
  twoWeeks: keyFileOf(KEY_FILE_FIXTURE_ROWS.twoWeeks.chars, KEY_FILE_FIXTURE_ROWS.twoWeeks.pairs),
};
