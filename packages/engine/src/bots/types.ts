import type { PlayerState } from "../reducers/state";
import type { EngineSettings } from "../types";

/**
 * The bot levels, slowest first (spec 9, ARCHITECTURE 7.5). The one source of the level scale:
 * the protocol's `botLevelSchema` and the player-rank scale derive from it (#361, #381).
 */
export const BOT_LEVELS = ["recruit", "clerk", "officer", "commissar", "major"] as const;
export type BotLevel = (typeof BOT_LEVELS)[number];

/**
 * How a bot of one level types. Plain data: a new level or a demo profile is one row
 * (`botProfile`). The race server never reads these fields; it only calls `nextBotKeystroke`.
 */
export type BotProfile = {
  readonly level: BotLevel;
  /** Mean typing speed aimed at, in 5-character words per minute. */
  readonly targetWpm: number;
  /** Share of keys typed wrong, 0..1 (then corrected per the race's error mode; #361). */
  readonly errorRate: number;
  /** Chance of a longer pause before punctuation and accented characters, 0..1 (#361). */
  readonly hesitation: number;
  /** Strength of the burst-and-pause rhythm around the mean delay, 0..1: 0 is a flat rhythm (#361). */
  readonly burst: number;
};

/**
 * What a bot sees before its next key: the engine's own state of its desk, nothing server-specific,
 * so the model (#361) and the server driver (#366) share this shape unchanged.
 */
export type BotContext = {
  /** The desk's effective text (base plus overlays), `charsOf` a normalised text. */
  readonly chars: readonly string[];
  /** The desk's current state, as the reducers left it. */
  readonly state: PlayerState;
  /** The race's error mode and backspace rule (the bot corrects through the same reducers). */
  readonly settings: EngineSettings;
  /** Milliseconds since GO on the caller's clock. */
  readonly elapsedMs: number;
};

/** The bot's next key and how long to wait before pressing it (ms after the previous key). */
export type BotAction = { key: string; delayMs: number };
