import type { RaceSettings } from "@fifth-copy/protocol";
import { coreOf, isGenerated, isWord, pick, poolOf, replacementTest, swapCore } from "../tokens";
import type { Transform } from "./types";

/** Share of the words that hold each practice letter in random words and the drill (C2). */
export const LETTER_SHARE = 0.4;
/** Replacement words sampled per swap; the one holding the most needed letters wins. */
const SAMPLES = 8;

/** The host's practice letters, lower-case and distinct. */
export const practiceLettersOf = (settings: Pick<RaceSettings, "practiceLetters">) => [
  ...new Set(settings.practiceLetters.map((l) => l.toLowerCase())),
];

const holds = (token: string, letter: string) => coreOf(token).toLowerCase().includes(letter);

/**
 * Practice letters (C2) in random words and the drill: while a letter is in fewer than 40 % of the
 * words, a word without it (preferably one holding no letter still short of its share) takes a word of
 * the frequency list that holds it, chosen among a few samples for the most letters still short. A
 * letter no list word holds is skipped. Real sentences are ranked by `letterDensity` instead.
 */
export const practiceLettersTransform: Transform = (tokens, settings, rng, lists) => {
  const letters = practiceLettersOf(settings);
  if (letters.length === 0 || !isGenerated(settings)) return [...tokens];
  const out = [...tokens];
  const positions = out.flatMap((t, i) => (isWord(t) ? [i] : []));
  const need = Math.ceil(LETTER_SHARE * positions.length);
  const counts = new Map(
    letters.map((l) => [l, positions.filter((i) => holds(out[i]!, l)).length]),
  );
  const { key, test } = replacementTest(settings);
  const live = new Set(letters);
  const short = () => [...live].filter((l) => counts.get(l)! < need);

  for (let round = 0; round < positions.length * letters.length; round++) {
    const missing = short().sort((a, b) => counts.get(a)! - counts.get(b)!);
    const letter = missing[0];
    if (letter === undefined) break;
    const pool = poolOf(lists, `letters:${key}:${letter}`, (w) => test(w) && w.includes(letter));
    if (pool.length === 0) {
      live.delete(letter);
      continue;
    }
    // the position whose swap costs the fewest letters at or under their share
    const start = Math.floor(rng() * positions.length);
    let best = -1;
    let bestCost = Infinity;
    for (let k = 0; k < positions.length && bestCost > 0; k++) {
      const i = positions[(start + k) % positions.length]!;
      if (holds(out[i]!, letter)) continue;
      const cost = letters.filter((l) => holds(out[i]!, l) && counts.get(l)! <= need).length;
      if (cost < bestCost) [best, bestCost] = [i, cost];
    }
    if (best < 0) break;
    const wanted = new Set([...missing, ...letters.filter((l) => holds(out[best]!, l))]);
    let word = pick(pool, rng);
    let score = -1;
    for (let s = 0; s < SAMPLES; s++) {
      const w = s === 0 ? word : pick(pool, rng);
      const n = [...wanted].filter((l) => w.includes(l)).length;
      if (n > score) [word, score] = [w, n];
    }
    for (const l of letters) if (holds(out[best]!, l)) counts.set(l, counts.get(l)! - 1);
    out[best] = swapCore(out[best]!, word);
    for (const l of letters) if (holds(out[best]!, l)) counts.set(l, counts.get(l)! + 1);
  }
  return out;
};

/** Share of a passage's letters that are practice letters. */
export function letterDensity(text: string, letters: readonly string[]): number {
  const chars = [...text.toLowerCase()].filter((c) => /\p{L}/u.test(c));
  if (chars.length === 0) return 0;
  const set = new Set(letters);
  return chars.filter((c) => set.has(c)).length / chars.length;
}
