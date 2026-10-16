/**
 * The race clock (#214, ADR 0006, ARCHITECTURE 7.3): the server owns the countdown, so GO (`race.t0`)
 * is an instant on the server's clock. These helpers are pure; the binder reads the device clock and
 * passes it in. The offset comes from `welcome.serverNow` (the `ping`/`pong` refinement is #172's).
 */

/** The offset that turns this device's clock into the server's: server time = local time + offset. */
export function clockOffset(serverNow: number, receivedAt: number): number {
  return serverNow - receivedAt;
}

/** Milliseconds from `now` (server clock) until `t0`, never negative: a timer delay. */
export function remainingTo(t0: number, now: number): number {
  return Math.max(0, t0 - now);
}
