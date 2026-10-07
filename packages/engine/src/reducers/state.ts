import type { PlayerStatus } from "../types";

/**
 * One player's race state. Plain, immutable, JSON-serialisable (`null`, never `undefined`):
 * the race server holds it as the authority, the browser holds the same shape for prediction.
 *
 * Invariant: `typed.length === cursor` in both error modes.
 */
export type PlayerState = {
  /** Index of the next expected character of the (normalised) text. */
  readonly cursor: number;
  /** Correct key presses counted (undone by backspace). */
  readonly correct: number;
  /** Wrong key presses counted (undone by backspace in Continue mode). */
  readonly errors: number;
  /** All accepted key presses, backspace included (never decreases). */
  readonly total: number;
  /** `typed[i]`: the wrong key shown struck at position `i` (Continue mode), `null` when correct. */
  readonly typed: readonly (string | null)[];
  readonly status: PlayerStatus;
  /** `t` of the last accepted keystroke (ms since GO). */
  readonly lastT: number;
  /** `t` when the cursor reached the end of the text, else `null`. */
  readonly finishedAt: number | null;
};

export function initialState(): PlayerState {
  return {
    cursor: 0,
    correct: 0,
    errors: 0,
    total: 0,
    typed: [],
    status: "typing",
    lastT: 0,
    finishedAt: null,
  };
}

/** The common part of every accepted press: count it and stamp its time. */
export function pressed(state: PlayerState, t: number): PlayerState {
  return { ...state, total: state.total + 1, lastT: t };
}

/** Marks the state finished when the cursor has reached the end of the text. */
export function finishIfDone(state: PlayerState, textLength: number, t: number): PlayerState {
  return state.cursor >= textLength ? { ...state, status: "finished", finishedAt: t } : state;
}
