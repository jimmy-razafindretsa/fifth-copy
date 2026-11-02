import { BACKSPACE } from "../reducers/apply";
import type { PlayerState } from "../reducers/state";
import type { EngineSettings, Rng } from "../types";

/**
 * Errors and corrections (#361, R124). The model is stateless: it reads the desk's state to know
 * whether it owes a correction, and every key goes through `applyKeystroke` like a human's.
 * - `continue` with backspace: a wrong key left behind is backspaced, then the position retyped;
 * - `continue` without backspace: the bot types on;
 * - `block`: the reducer did not move the cursor, so the next call simply types the position again.
 */

/** QWERTY neighbours of each letter: a slip lands next to the intended key. */
// prettier-ignore
const NEIGHBOURS: Readonly<Record<string, string>> = {
  q: "wa", w: "qes", e: "wrd", r: "etf", t: "ryg", y: "tuh", u: "yij", i: "uok", o: "ipl",
  p: "ol", a: "qsz", s: "adw", d: "sfe", f: "dgr", g: "fht", h: "gjy", j: "hku", k: "jli",
  l: "ko", z: "xa", x: "zcs", c: "xvd", v: "cbf", b: "vng", n: "bmh", m: "nj",
};
const LOWER = "abcdefghijklmnopqrstuvwxyz";

/** A wrong key for `expected`: a keyboard neighbour (case kept) or a random letter; never `expected`. */
export function wrongKey(expected: string, rng: Rng): string {
  const lower = expected.toLowerCase();
  const near = NEIGHBOURS[lower];
  if (near) {
    const key = near[Math.floor(rng() * near.length)] as string;
    return expected === lower ? key : key.toUpperCase();
  }
  // Not an a-z letter (accent, space, punctuation): any a-z letter differs from it.
  return LOWER[Math.floor(rng() * LOWER.length)] as string;
}

/** `Backspace` when the last typed key was wrong and the race lets the bot take it back, else null. */
export function correction(state: PlayerState, settings: EngineSettings): typeof BACKSPACE | null {
  if (settings.errorMode !== "continue" || !settings.backspace || state.cursor === 0) return null;
  return state.typed[state.cursor - 1] != null ? BACKSPACE : null;
}

/** A backspace takes this many mean delays (the typist notices, then reaches for the key). */
export const BACKSPACE_UNITS = 1.5;
