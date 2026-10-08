/**
 * Public data contract of the engine. Plain, JSON-serialisable types only: these cross the wire
 * (see @fifth-copy/protocol) and are stored on race results.
 */

/** Host-chosen error handling (spec section 4.3). */
export type ErrorMode = "continue" | "block";

/** The subset of host settings the engine needs. The full settings schema lives in @fifth-copy/protocol. */
export type EngineSettings = {
  errorMode: ErrorMode;
  /** Backspace allowed (host may disable it in continue mode). */
  backspace: boolean;
};

/**
 * One keystroke as sent by a client or produced by a bot.
 * `t` is milliseconds since the race's GO instant on the sender's monotonic clock; the server
 * validates it against its own clock (docs/architecture/ARCHITECTURE.md section 7.3).
 * `key` is one NFC-normalised typeable character, or "Backspace".
 */
export type Keystroke = { t: number; key: string };

/** Why a player is no longer typing (spec sections 4.4, 4.5, 7.4). */
export type PlayerStatus =
  | "typing"
  | "finished"
  | "abandoned" // ranked last, "Reassigned"
  | "asleep" // idle kick, "Asleep at desk"
  | "line-cut" // disconnected, grace period running
  | "expired"; // grace period over, ranked by progress at disconnect

/** Deterministic random source for bots and tests (never Math.random inside the engine). */
export type Rng = () => number;

/** The catch-up bonuses (spec 10, ADR 0016). Mirrored by `bonusKindSchema` in @fifth-copy/protocol. */
export type BonusKind = "extra-paperwork" | "exemption" | "smoke-break";

/**
 * One desk's changes to the base text (ADR 0007): `extra` words appended at the end, `removed` base
 * word indexes. Treated as immutable. Mirrored by `textOverlaySchema` in @fifth-copy/protocol.
 */
export type TextOverlay = { extra: string[]; removed: number[] };
