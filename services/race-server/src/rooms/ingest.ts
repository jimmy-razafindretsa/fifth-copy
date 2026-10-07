import { applyKeystroke, type Keystroke } from "@fifth-copy/engine";
import { MAX_RACE_MS, type Rejected } from "@fifth-copy/protocol";
import { traceCapOf, type RoomRuntime } from "./desks-state";

/** How far behind the server clock a keystroke's `t` may be (ARCHITECTURE 7.3). */
export const MAX_LAG_MS = 2_000;
/** How far ahead of the server clock a keystroke's `t` may be. */
export const MAX_LEAD_MS = 200;
/**
 * Sustained keystrokes per second a desk may send: 40/s is ~480 WPM, about twice the fastest
 * recorded human bursts, so a fast typist with corrections is never refused.
 */
export const KEYS_PER_SECOND = 40;
/** Keystrokes a desk may send at once (two full batches), e.g. after a network stall. */
export const KEYS_BURST = 128;

export type IngestResult = {
  /** Sent back as `rejected`; absent when the batch was applied or silently dropped. */
  rejected?: Rejected["reason"];
  /** The desk reached a terminal status in this batch (the caller asks the lifecycle to end). */
  terminal: boolean;
};

const DROPPED: IngestResult = { terminal: false };

/**
 * The one entry for a desk's keystrokes (ADR 0006 point 3, 0007; ARCHITECTURE 7.3). Synchronous and
 * Redis-free: the runtime is the authority, `tick` mirrors it. No runtime yet means the room is
 * waiting or counting down (`before-go`); an ended runtime is `not-running`. A desk outside the race
 * or not `typing` is dropped silently. Each `t` (ms since GO, client clock) is clamped into
 * `[elapsed - MAX_LAG_MS, min(elapsed + MAX_LEAD_MS, MAX_RACE_MS)]`, then raised to the desk's
 * `lastT` (the engine ignores an older `t`); a clamp, a decrease within the batch or a raise counts
 * one timing anomaly per batch. Every key then goes through `applyKeystroke`, in order, until the
 * desk stops typing; the applied keystrokes are appended to the trace. Two bounds per desk: a
 * budget of `KEYS_PER_SECOND` refilled on the server clock (at most `KEYS_BURST`), and a history of
 * at most `traceCapOf(textLength)` keystrokes; a key over either is neither applied nor traced and
 * counts in `droppedKeys`. Bots (#366) and the shared socket limiter (#207) wrap this function.
 */
export function ingest(
  runtime: RoomRuntime | undefined,
  desk: number,
  batch: readonly Keystroke[],
  now: number,
): IngestResult {
  if (!runtime) return { rejected: "before-go", terminal: false };
  if (runtime.phase !== "running") return { rejected: "not-running", terminal: false };
  const start = runtime.states.get(desk);
  if (start?.status !== "typing") return DROPPED;

  const elapsed = now - runtime.t0;
  const hi = Math.max(0, Math.min(elapsed + MAX_LEAD_MS, MAX_RACE_MS));
  const lo = Math.min(hi, Math.max(0, elapsed - MAX_LAG_MS));
  const { text, engine } = runtime;
  const { trace } = start;

  const cap = traceCapOf(runtime.textLength);
  const budget = runtime.budgets.get(desk) ?? { tokens: KEYS_BURST, at: now };
  budget.tokens = Math.min(
    KEYS_BURST,
    budget.tokens + (Math.max(0, now - budget.at) * KEYS_PER_SECOND) / 1000,
  );
  budget.at = now;
  runtime.budgets.set(desk, budget);

  let state = start;
  let anomaly = false;
  let dropped = 0;
  let previous = -1;
  for (const { t, key } of batch) {
    if (state.status !== "typing") break;
    if (budget.tokens < 1 || trace.length >= cap) {
      dropped += 1;
      continue;
    }
    budget.tokens -= 1;
    const clamped = Math.min(hi, Math.max(lo, t));
    const applied = Math.max(clamped, state.lastT);
    if (clamped !== t || t < previous || applied !== clamped) anomaly = true;
    previous = t;
    const keystroke = { t: applied, key };
    trace.push(keystroke);
    // The reducer returns a `PlayerState`: keep the desk fields around it.
    state = { ...state, ...applyKeystroke(state, keystroke, text, engine) };
  }

  const next = {
    ...state,
    lastKeyAt: now,
    timingAnomalies: start.timingAnomalies + (anomaly ? 1 : 0),
    droppedKeys: start.droppedKeys + dropped,
    trace,
  };
  runtime.states.set(desk, next);
  runtime.dirty.add(desk);
  return { terminal: next.status !== "typing" };
}
