import { pressed, type PlayerState } from "./state";

/**
 * Backspace (spec 4.3): when allowed and the cursor is past 0, moves back one character and undoes
 * the counter of what was there (`typed` entry: `null` = correct, else an error). Otherwise it is
 * only a counted key press (`total`), never an error.
 */
export function backspace(state: PlayerState, allowed: boolean, t: number): PlayerState {
  const base = pressed(state, t);
  if (!allowed || state.cursor === 0) return base;
  const wasCorrect = state.typed[state.cursor - 1] === null;
  return {
    ...base,
    cursor: state.cursor - 1,
    correct: state.correct - (wasCorrect ? 1 : 0),
    errors: state.errors - (wasCorrect ? 0 : 1),
    typed: state.typed.slice(0, -1),
  };
}
