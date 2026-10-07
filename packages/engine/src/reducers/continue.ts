import { finishIfDone, pressed, type PlayerState } from "./state";

/**
 * Continue mode (spec 4.3): every key advances the cursor. A wrong key counts as an error and is
 * recorded in `typed` for the overstrike. The state finishes when the cursor reaches the end of
 * the text, by any key (a wrong last character must not leave the player stuck when backspace
 * is disabled).
 */
export function continueMode(
  state: PlayerState,
  key: string,
  text: string,
  t: number,
): PlayerState {
  const ok = key === text[state.cursor];
  const next: PlayerState = {
    ...pressed(state, t),
    cursor: state.cursor + 1,
    correct: state.correct + (ok ? 1 : 0),
    errors: state.errors + (ok ? 0 : 1),
    typed: [...state.typed, ok ? null : key],
  };
  return finishIfDone(next, text.length, t);
}
