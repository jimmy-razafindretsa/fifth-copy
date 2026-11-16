import { applyKeystroke, BACKSPACE } from "../reducers/apply";
import { initialState } from "../reducers/state";
import type { EngineSettings, Keystroke } from "../types";

/**
 * One accepted keystroke of a replay, charged to a position of the text (private to `scoring/`:
 * `keyErrors` and `keyStats` reduce over it; a later tally is one more reducer, #960).
 * - `press`: a non-backspace press made while `index` was expected; `wrong` when the reducer counted
 *   an error; `gapMs` since the previous accepted keystroke (backspace included), `null` for the first.
 * - `undo`: a backspace that took back the error at `index` (Continue mode with backspace on).
 */
export type PressRecord =
  | {
      readonly kind: "press";
      readonly index: number;
      readonly wrong: boolean;
      readonly gapMs: number | null;
    }
  | { readonly kind: "undo"; readonly index: number };

/**
 * The one replay of a trace on its (normalised, effective) text through `applyKeystroke`, as
 * `replayTrace`: rejected keystrokes yield nothing; an accepted backspace yields an `undo` only when
 * it removed an error (`typed[i]` not null), so the undone errors always match the reducer's count.
 */
export function* replayPresses(
  keystrokes: readonly Keystroke[],
  text: string,
  settings: EngineSettings,
): Generator<PressRecord> {
  let state = initialState();
  let prevT: number | null = null;
  for (const k of keystrokes) {
    const next = applyKeystroke(state, k, text, settings);
    if (next === state) continue;
    if (k.key === BACKSPACE) {
      const undone = next.cursor < state.cursor ? state.typed[state.cursor - 1] : null;
      if (undone != null) yield { kind: "undo", index: state.cursor - 1 };
    } else {
      yield {
        kind: "press",
        index: state.cursor,
        wrong: next.errors > state.errors,
        gapMs: prevT === null ? null : k.t - prevT,
      };
    }
    prevT = k.t;
    state = next;
  }
}
