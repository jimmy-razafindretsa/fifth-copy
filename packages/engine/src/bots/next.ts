import type { Rng } from "../types";
import type { BotAction, BotContext, BotProfile } from "./types";

/** Characters in one WPM word. */
const WORD_CHARS = 5;

/**
 * The bot's next keystroke, or `null` when it has nothing left to type (its desk is not typing,
 * or the cursor is at the end of `ctx.chars`). Pure and deterministic: randomness comes only from
 * `rng`.
 *
 * STUB (#729): always the next expected character, at the level's mean delay
 * `60000 / (targetWpm * 5)` ms, never an error; `rng` is unused. #361 replaces the body with the
 * real model (rhythm, errors and corrections, hesitation) behind this same signature.
 */
export function nextBotKeystroke(profile: BotProfile, ctx: BotContext, rng: Rng): BotAction | null {
  void rng;
  const { state, chars } = ctx;
  if (state.status !== "typing" || state.cursor >= chars.length) return null;
  const key = chars[state.cursor];
  if (key === undefined) return null;
  return { key, delayMs: 60000 / (profile.targetWpm * WORD_CHARS) };
}
