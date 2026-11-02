import { applyKeystroke, BACKSPACE } from "../../reducers/apply";
import { initialState, type PlayerState } from "../../reducers/state";
import { mulberry32 } from "../../testing/rng";
import { charsOf } from "../../text/chars";
import { traceCapOf } from "../../trace/cap";
import type { EngineSettings, Keystroke } from "../../types";
import { nextBotKeystroke } from "../next";
import type { BotLanguage, BotProfile } from "../types";

/** One bot key as the test sees it: where the cursor was, what was expected, what was pressed. */
export type DrivenKey = {
  readonly key: string;
  readonly delayMs: number;
  readonly t: number;
  readonly cursor: number;
  readonly expected: string;
  readonly wrong: boolean;
};

export type Run = {
  readonly keys: readonly DrivenKey[];
  readonly trace: readonly Keystroke[];
  readonly state: PlayerState;
};

export const SEEDS = Array.from({ length: 50 }, (_, i) => i + 1);

export const MODES: readonly EngineSettings[] = [
  { errorMode: "continue", backspace: true },
  { errorMode: "continue", backspace: false },
  { errorMode: "block", backspace: true },
  { errorMode: "block", backspace: false },
];

/**
 * Drives one bot through `text` like the race server will (#366): ask for the next key, wait its
 * delay, feed it through `applyKeystroke`. Bounded by the trace cap, so a model that never ends
 * fails instead of hanging.
 */
export function drive(
  profile: BotProfile,
  text: string,
  settings: EngineSettings,
  seed: number,
  language?: BotLanguage,
): Run {
  const chars = charsOf(text);
  const rng = mulberry32(seed);
  const keys: DrivenKey[] = [];
  const trace: Keystroke[] = [];
  let state = initialState();
  let t = 0;
  for (let n = 0; n < traceCapOf(chars.length); n++) {
    const action = nextBotKeystroke(
      profile,
      { chars, state, settings, elapsedMs: t, language },
      rng,
    );
    if (!action) break;
    t += action.delayMs;
    const expected = chars[state.cursor] as string;
    keys.push({
      ...action,
      t,
      cursor: state.cursor,
      expected,
      wrong: action.key !== BACKSPACE && action.key !== expected,
    });
    trace.push({ t, key: action.key });
    state = applyKeystroke(state, { t, key: action.key }, text, settings);
  }
  return { keys, trace, state };
}

export function mean(xs: readonly number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Coefficient of variation (population), as `analyseTrace` computes it. */
export function cv(xs: readonly number[]): number {
  const m = mean(xs);
  const variance = xs.reduce((a, x) => a + (x - m) * (x - m), 0) / xs.length;
  return Math.sqrt(variance) / m;
}
