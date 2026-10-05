import { EN_WORDS, FR_WORDS } from "./words";

// Same shape as the engine's Rng (packages/engine/src/types.ts): a float in
// [0, 1). Redeclared because identity does not import the engine.
export type Rng = () => number;

// The visitor's locale is unknown at write time and the name is shown to every
// locale, so guests draw from both lists. Stored bare; the UI adds Comrade/Camarade.
export const TYPIST_WORDS: readonly string[] = [...new Set<string>([...EN_WORDS, ...FR_WORDS])];

const THREE_DIGIT_DRAWS = 5;
const FOUR_DIGIT_DRAWS = 5;

function pick(rng: Rng, words: readonly string[]): string {
  return words[Math.floor(rng() * words.length)]!;
}

function draw(rng: Rng, words: readonly string[], min: number, span: number): string {
  return `${pick(rng, words)}-${min + Math.floor(rng() * span)}`;
}

// Pure: `<Word>-<100..999>`, e.g. "Sparrow-482".
export function generateTypistName(rng: Rng, words: readonly string[] = TYPIST_WORDS): string {
  return draw(rng, words, 100, 900);
}

// Draws names until `tryCreate` accepts one (returns non-null; null = taken).
// 5 three-digit draws, then 4-digit suffixes (`<Word>-<1000..9999>`), so the
// unique index on typistName never reaches the caller in practice.
export async function withUniqueTypistName<T>(
  rng: Rng,
  tryCreate: (name: string) => Promise<T | null>,
  words: readonly string[] = TYPIST_WORDS,
): Promise<T> {
  for (let i = 0; i < THREE_DIGIT_DRAWS; i++) {
    const created = await tryCreate(generateTypistName(rng, words));
    if (created !== null) return created;
  }
  for (let i = 0; i < FOUR_DIGIT_DRAWS; i++) {
    const created = await tryCreate(draw(rng, words, 1000, 9000));
    if (created !== null) return created;
  }
  throw new Error("No free typist name");
}
