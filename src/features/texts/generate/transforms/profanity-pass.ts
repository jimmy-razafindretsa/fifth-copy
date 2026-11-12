import { isClean } from "../../profanity/is-clean";
import { coreOf, hasAccent, pick, poolOf, replacementTest, swapCore } from "../tokens";
import { numberOf } from "./include-toggles";
import { practiceLettersOf } from "./practice-letters";
import type { Transform } from "./types";

const CACHE_SIZE = 50_000;
const verdicts = new Map<string, boolean>();

/** `isClean`, remembered: generated words and pairs repeat across texts. */
export function cachedIsClean(text: string): boolean {
  let verdict = verdicts.get(text);
  if (verdict === undefined) {
    if (verdicts.size >= CACHE_SIZE) verdicts.clear();
    verdicts.set(text, (verdict = isClean(text)));
  }
  return verdict;
}

/** Replacement words sampled per redraw for one that keeps the old word's practice letters. */
const SAMPLES = 50;

/** Redraws of one slot before the pass drops its word (C5). */
export const MAX_REDRAWS = 20;

/**
 * Keeps every token and every adjacent pair clean (C5, ADR 0001: `isClean` of this feature, no second
 * list). Tokens are checked in order; a blocked token, or one that is blocked together with the token
 * kept before it, is replaced by `redraw(token)` up to `MAX_REDRAWS` times, then dropped (the count
 * fix-up refills the text). Never throws.
 */
export function cleanTokens(
  tokens: readonly string[],
  redraw: (token: string) => string,
  clean: (text: string) => boolean = cachedIsClean,
): string[] {
  const out: string[] = [];
  for (const token of tokens) {
    let candidate = token;
    let kept = false;
    for (let tries = 0; tries <= MAX_REDRAWS; tries++) {
      if (tries > 0) candidate = redraw(token);
      const prev = out.at(-1);
      if (clean(candidate) && (prev === undefined || clean(`${prev} ${candidate}`))) {
        kept = true;
        break;
      }
    }
    if (kept) out.push(candidate);
  }
  return out;
}

/**
 * The profanity pass, last of the transforms: a word redraws from the frequency list under the same
 * rules as the other swaps (accent, no apostrophe), a number redraws as another number, and the
 * token's marks and symbols stay.
 */
export const profanityTransform: Transform = (tokens, settings, rng, lists) => {
  const { key, test } = replacementTest(settings);
  const plain = poolOf(lists, `clean:${key}`, (w) => test(w) && isClean(w));
  const accented = poolOf(
    lists,
    `clean:${key}:accent`,
    (w) => test(w) && hasAccent(w) && isClean(w),
  );
  const letters = practiceLettersOf(settings);
  return cleanTokens(tokens, (token) => {
    const core = coreOf(token);
    if (core === "") return token;
    if (/^\p{N}+$/u.test(core)) return swapCore(token, numberOf(rng));
    // the new word keeps what the old one counted for: its accent, then its practice letters
    const pool = hasAccent(core) && accented.length > 0 ? accented : plain;
    if (pool.length === 0) return token;
    const held = letters.filter((l) => core.toLowerCase().includes(l));
    let word = pick(pool, rng);
    for (let s = 1; s < SAMPLES && !held.every((l) => word.includes(l)); s++)
      word = pick(pool, rng);
    // a glued number ("été-12") keeps its digits
    const glued = core.match(/-\p{N}+$/u)?.[0] ?? "";
    return swapCore(token, `${word}${glued}`);
  });
};
