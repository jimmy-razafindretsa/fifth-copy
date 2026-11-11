import { applyKeystroke, BACKSPACE } from "../reducers/apply";
import { initialState } from "../reducers/state";
import type { EngineSettings, Keystroke } from "../types";

/** One expected character of a replay: the presses made while it was expected, and the wrong ones. */
export type KeyTally = {
  /** The character the text asked for (one normalised typeable character, `" "` for a space). */
  readonly char: string;
  /** Accepted key presses (backspace excluded) made while this character was expected. */
  readonly attempts: number;
  /** Of these, the wrong ones still counted at the end (a backspace in Continue mode undoes one). */
  readonly errors: number;
};

export type KeyErrorsInput = {
  readonly keystrokes: readonly Keystroke[];
  /** The text the desk typed: its effective text (base plus overlay, ADR 0016), already normalised. */
  readonly text: string;
  readonly settings: EngineSettings;
};

/**
 * Which keys a desk missed (#867, spec 11.3 "errors by key"): the trace replayed on its text with
 * `applyKeystroke` (as `replayTrace`), each accepted press charged to the character expected under the
 * cursor at that moment. An error is charged when the reducer counts one; a backspace that undoes an
 * error in Continue mode (`typed[i]` not null) takes it back from the character at `i`. So the errors
 * here always add up to the replayed state's `errors`, in both modes. Attempts are presses and are
 * never taken back. One tally per expected character, in the order the text first asked for it; a
 * character never pressed for is absent. Pure; scoring is unchanged.
 */
export function keyErrors({ keystrokes, text, settings }: KeyErrorsInput): KeyTally[] {
  const tallies = new Map<string, { attempts: number; errors: number }>();
  const at = (char: string) => {
    let tally = tallies.get(char);
    if (!tally) {
      tally = { attempts: 0, errors: 0 };
      tallies.set(char, tally);
    }
    return tally;
  };
  let state = initialState();
  for (const k of keystrokes) {
    const next = applyKeystroke(state, k, text, settings);
    if (next !== state) {
      if (k.key === BACKSPACE) {
        const undone = next.cursor < state.cursor ? state.typed[state.cursor - 1] : null;
        if (undone != null) at(text[state.cursor - 1]!).errors -= 1;
      } else {
        const tally = at(text[state.cursor]!);
        tally.attempts += 1;
        if (next.errors > state.errors) tally.errors += 1;
      }
    }
    state = next;
  }
  return [...tallies].map(([char, { attempts, errors }]) => ({ char, attempts, errors }));
}
