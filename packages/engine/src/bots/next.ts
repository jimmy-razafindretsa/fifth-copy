import type { Rng } from "../types";
import { BACKSPACE_UNITS, correction, wrongKey } from "./errors";
import { PAUSE_MEAN, hesitatesBefore, pauseUnits } from "./hesitation";
import { jitter, paceFactor } from "./pace";
import type { BotAction, BotContext, BotProfile } from "./types";

/** Characters in one WPM word. */
const WORD_CHARS = 5;
/** Spread of the per-key jitter (lognormal sigma): with the burst rhythm, a CV well above 0.25. */
const SIGMA = 0.3;

/**
 * The mean of the pace factors and expected pauses over a text, so the bot's mean delay per
 * character is the level's `60000 / (targetWpm * 5)` whatever the text's mix of words (C2).
 * Memoised per `chars` array (a pure function of it and the profile's two fields).
 */
const norms = new WeakMap<readonly string[], Map<string, number>>();
function normOf(ctx: BotContext, profile: BotProfile): number {
  const { chars, language } = ctx;
  const key = `${profile.burst}|${profile.hesitation}|${language ?? ""}`;
  let byKey = norms.get(chars);
  if (!byKey) norms.set(chars, (byKey = new Map()));
  const hit = byKey.get(key);
  if (hit !== undefined) return hit;
  let sum = 0;
  for (let i = 0; i < chars.length; i++) {
    sum += paceFactor(chars, i, profile.burst, language);
    if (hesitatesBefore(chars[i])) sum += profile.hesitation * PAUSE_MEAN;
  }
  const norm = chars.length ? sum / chars.length : 1;
  byKey.set(key, norm);
  return norm;
}

/**
 * The bot's next keystroke, or `null` when it has nothing left to type (its desk is not typing,
 * or the cursor is at the end of `ctx.chars`). Pure and deterministic: randomness comes only from
 * `rng`, time only from the returned `delayMs` (a float, ms after the previous key).
 *
 * Pipeline (#361): 1 correction owed (a wrong key left behind in `continue` with backspace) ->
 * `Backspace`; 2 pace: the level's mean delay times the burst factor of the word around the
 * cursor, normalised over the text, times a lognormal jitter; 3 hesitation: an extra pause before
 * punctuation and accented letters; 4 error: with chance `errorRate`, a neighbouring wrong key.
 */
export function nextBotKeystroke(profile: BotProfile, ctx: BotContext, rng: Rng): BotAction | null {
  const { state, chars, settings, language } = ctx;
  if (state.status !== "typing" || state.cursor >= chars.length) return null;
  const expected = chars[state.cursor];
  if (expected === undefined) return null;
  const unit = 60000 / (profile.targetWpm * WORD_CHARS) / normOf(ctx, profile);

  const fix = correction(state, settings);
  if (fix) return { key: fix, delayMs: unit * BACKSPACE_UNITS * jitter(rng, SIGMA) };

  const pace = paceFactor(chars, state.cursor, profile.burst, language) * jitter(rng, SIGMA);
  const pause = pauseUnits(expected, profile.hesitation, rng);
  const key = rng() < profile.errorRate ? wrongKey(expected, rng) : expected;
  return { key, delayMs: unit * (pace + pause) };
}
