import type { EngineSettings, Keystroke } from "../types";
import { replayPresses } from "./presses";

/** The longest gap (ms, inclusive) between two accepted keystrokes for the second to count as typing time. */
export const KEY_PAUSE_MS = 2000;

/** Presses, errors and typing time charged to one expected character or pair. */
export type KeyCounts = {
  /** Accepted key presses (backspace excluded) made while it was expected. */
  readonly attempts: number;
  /** Of these, the wrong ones still counted at the end (a backspace in Continue mode undoes one). */
  readonly errors: number;
  /** Right presses timed: an accepted keystroke came before, at most `KEY_PAUSE_MS` earlier. */
  readonly timedHits: number;
  /** The sum of those gaps (ms). */
  readonly totalMs: number;
};
export type CharStat = KeyCounts & { readonly char: string };
/** `pair` = `text[i - 1] + text[i]`, charged with the presses made at `i` (i >= 1). */
export type PairStat = KeyCounts & { readonly pair: string };
export type KeyStats = { readonly chars: CharStat[]; readonly pairs: PairStat[] };

export type KeyStatsInput = {
  readonly keystrokes: readonly Keystroke[];
  /** The desk's effective text (ADR 0016), already normalised. */
  readonly text: string;
  readonly settings: EngineSettings;
};

type Mutable = { attempts: number; errors: number; timedHits: number; totalMs: number };

function tallies() {
  const map = new Map<string, Mutable>();
  const at = (key: string) => {
    let t = map.get(key);
    if (!t) {
      t = { attempts: 0, errors: 0, timedHits: 0, totalMs: 0 };
      map.set(key, t);
    }
    return t;
  };
  return { map, at };
}

/**
 * Per expected character and per pair of consecutive expected characters (#960): presses, errors and
 * typing time of one trace, from the same replay as `keyErrors` (so `chars` agrees with it). A right
 * press is timed when an accepted keystroke came before it within `KEY_PAUSE_MS`; the first keystroke
 * and wrong presses never are. Pairs cover every character class (the caller filters). Both lists in
 * the order the text first asked for them; one never pressed for is absent. Pure.
 */
export function keyStats({ keystrokes, text, settings }: KeyStatsInput): KeyStats {
  const chars = tallies();
  const pairs = tallies();
  for (const r of replayPresses(keystrokes, text, settings)) {
    const targets = [chars.at(text[r.index]!)];
    if (r.index >= 1) targets.push(pairs.at(text[r.index - 1]! + text[r.index]!));
    for (const t of targets) {
      if (r.kind === "undo") {
        t.errors -= 1;
        continue;
      }
      t.attempts += 1;
      if (r.wrong) t.errors += 1;
      else if (r.gapMs !== null && r.gapMs <= KEY_PAUSE_MS) {
        t.timedHits += 1;
        t.totalMs += r.gapMs;
      }
    }
  }
  return {
    chars: [...chars.map].map(([char, c]) => ({ char, ...c })),
    pairs: [...pairs.map].map(([pair, c]) => ({ pair, ...c })),
  };
}
