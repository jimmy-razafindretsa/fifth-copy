import type { PlayerState } from "../reducers/state";

/** Characters per word for every WPM figure (spec 4.2). Not the text-length setting (`wordCount`). */
const CHARS_PER_WORD = 5;
const MS_PER_MINUTE = 60_000;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Words (5 characters) per minute for `chars` characters over `elapsedMs`; 0 when no time has passed. */
function perMinute(chars: number, elapsedMs: number): number {
  if (!(elapsedMs > 0)) return 0;
  return chars / CHARS_PER_WORD / (elapsedMs / MS_PER_MINUTE);
}

/**
 * Net WPM: `(correct / 5) / minutes`. `elapsedMs` is milliseconds since GO, chosen by the caller
 * (see `elapsedFor`); `0` when `elapsedMs <= 0`.
 */
export function wpm({ correct }: Pick<PlayerState, "correct">, elapsedMs: number): number {
  return perMinute(correct, elapsedMs);
}

/** Raw WPM: `((correct + errors) / 5) / minutes`; `0` when `elapsedMs <= 0`. */
export function rawWpm(
  { correct, errors }: Pick<PlayerState, "correct" | "errors">,
  elapsedMs: number,
): number {
  return perMinute(correct + errors, elapsedMs);
}

/**
 * `correct / total` in `[0, 1]`, `1` when nothing was pressed. `total` counts every accepted press,
 * Backspace included (spec 4.2 "total keystrokes"), while `correct` is net of Backspace undo: erasing
 * and retyping lowers accuracy by design.
 */
export function accuracy({ correct, total }: Pick<PlayerState, "correct" | "total">): number {
  if (total <= 0) return 1;
  return clamp01(correct / total);
}

/** `cursor / textLength` in `[0, 1]`; `1` for a finished state, `0` for an empty text. */
export function progress(
  { cursor, status }: Pick<PlayerState, "cursor" | "status">,
  textLength: number,
): number {
  if (status === "finished") return 1;
  if (textLength <= 0) return 0;
  return clamp01(cursor / textLength);
}

/**
 * The elapsed time (ms since GO) to score a player with: `finishedAt` for a finished player,
 * otherwise `raceElapsedMs`, which the caller decides.
 *
 * Per ADR 0007 unfinished players are timed at their last keystroke, or at race end for timer expiry.
 * Callers (#166 final results, #173 live ranking, #189 persistence) therefore pass `state.lastT` for
 * `asleep`, `abandoned`, `expired` and `line-cut` players, and the race end only for a player still
 * `typing` when the timer expires, so idle time never deflates WPM.
 */
export function elapsedFor(
  { status, finishedAt }: Pick<PlayerState, "status" | "finishedAt">,
  raceElapsedMs: number,
): number {
  return status === "finished" && finishedAt !== null ? finishedAt : raceElapsedMs;
}
