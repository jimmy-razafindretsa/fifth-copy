import { finishIfDone, pressed, type PlayerState } from "./state";

/**
 * Block mode (spec 4.3): the cursor stays on the letter until the correct key; every wrong press
 * counts as an error. Only a correct key can finish the text.
 */
export function blockMode(state: PlayerState, key: string, text: string, t: number): PlayerState {
  if (key !== text[state.cursor]) {
    return { ...pressed(state, t), errors: state.errors + 1 };
  }
  const next: PlayerState = {
    ...pressed(state, t),
    cursor: state.cursor + 1,
    correct: state.correct + 1,
    typed: [...state.typed, null],
  };
  return finishIfDone(next, text.length, t);
}
