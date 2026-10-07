import { normalizeKey } from "../text/normalize";
import type { EngineSettings, Keystroke } from "../types";
import { backspace } from "./backspace";
import { blockMode } from "./block";
import { continueMode } from "./continue";
import type { PlayerState } from "./state";

/** The `key` value of a backspace keystroke. */
export const BACKSPACE = "Backspace";

/**
 * Applies one keystroke to one player's state (ADR 0007). Pure: returns a new state, or the SAME
 * reference when the keystroke is rejected (status not "typing", `t` older than `lastT`, a key that
 * normalises to nothing, or no character left to type, e.g. an empty text).
 *
 * Precondition: `text` is already `normalizeTypeable`d (the server normalises once at race start,
 * the client receives it normalised), so `text[i]` is the i-th character. Only `key` is normalised
 * here, with the same table; a key that normalises to several characters is simply wrong.
 *
 * The only dispatcher: a new error mode is one reducer file plus one case below.
 */
export function applyKeystroke(
  state: PlayerState,
  keystroke: Keystroke,
  text: string,
  settings: EngineSettings,
): PlayerState {
  if (state.status !== "typing" || keystroke.t < state.lastT) return state;
  if (state.cursor >= text.length) return state; // empty text: nothing to type
  if (keystroke.key === BACKSPACE) return backspace(state, settings.backspace, keystroke.t);
  const key = normalizeKey(keystroke.key);
  if (key === "") return state;
  switch (settings.errorMode) {
    case "continue":
      return continueMode(state, key, text, keystroke.t);
    case "block":
      return blockMode(state, key, text, keystroke.t);
    default: {
      const unknown: never = settings.errorMode;
      throw new Error(`unknown error mode: ${String(unknown)}`);
    }
  }
}
