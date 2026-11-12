/**
 * The personal card's errors by key (#867, spec 11.3 "errors by key", bible 14.4): the engine's
 * `keyErrors` tallies (ADR 0007) as the keys the viewer missed, most missed first. Plain data, no Prisma
 * type: the query builds it from the viewer's own trace, the card and the /design specimens read it.
 */
import type { KeyTally } from "@fifth-copy/engine";

/** A key missed in this race: the expected character and how many errors it took. */
export type MissedKey = { char: string; count: number };

/** The most keys the card lists (bible 14.4 "Errors by key"). */
export const MAX_LISTED_KEYS = 5;

/** By count, most first; ties by character (code unit order), so the order never depends on the text. */
const byMissed = (a: MissedKey, b: MissedKey) =>
  b.count - a.count || (a.char < b.char ? -1 : a.char > b.char ? 1 : 0);

/** Every key with at least one error, most missed first (ties by character). */
export function missedKeys(tallies: readonly KeyTally[]): MissedKey[] {
  return tallies
    .filter((t) => t.errors > 0)
    .map((t) => ({ char: t.char, count: t.errors }))
    .sort(byMissed);
}

/**
 * A key that takes more than a plain press (the tip's `special` case, the guide's subject): anything
 * outside printable ASCII, i.e. the accented and French letters (é, ç, œ…, their capitals), the
 * guillemets « » and €, all typed with a dead key or a modifier on the class's layouts.
 */
export function isSpecialKey(char: string): boolean {
  return char.length === 1 && char.charCodeAt(0) > 0x7e;
}
