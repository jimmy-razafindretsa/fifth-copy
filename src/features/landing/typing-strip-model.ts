/**
 * Pure state of the "try the keys" strip (bible 7.7): character states, errors and the verdict stamp.
 * Practice only: race scoring lives in @fifth-copy/engine and is never reimplemented here; the strip
 * shows the bible's display formula, WPM = (characters / 5) / minutes, rounded.
 */
export type CharState = "done" | "wrong" | "next" | "remaining";

export type Verdict = { kind: "accepted"; wpm: number } | { kind: "returned"; errors: number };

const chars = (s: string) => Array.from(s);

export function charStates(target: string, typed: string): CharState[] {
  const want = chars(target);
  const got = chars(typed);
  return want.map((ch, i) => {
    if (i < got.length) return got[i] === ch ? "done" : "wrong";
    return i === got.length ? "next" : "remaining";
  });
}

export function countErrors(target: string, typed: string): number {
  const got = chars(typed);
  return chars(target).filter((ch, i) => i < got.length && got[i] !== ch).length;
}

export function isComplete(target: string, typed: string): boolean {
  return chars(typed).length >= chars(target).length;
}

export function wordsPerMinute(characters: number, elapsedMs: number): number {
  const minutes = Math.max(0.01, elapsedMs / 60_000);
  return Math.round(characters / 5 / minutes);
}

/** The stamp once the sentence is complete: zero errors = ACCEPTED with WPM, else RETURNED with errors. */
export function verdict(target: string, typed: string, elapsedMs: number): Verdict | null {
  if (!isComplete(target, typed)) return null;
  const errors = countErrors(target, typed);
  if (errors > 0) return { kind: "returned", errors };
  return { kind: "accepted", wpm: wordsPerMinute(chars(target).length, elapsedMs) };
}
