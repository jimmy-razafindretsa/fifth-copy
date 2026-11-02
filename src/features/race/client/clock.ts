/**
 * The race clock (#214, ADR 0006, ARCHITECTURE 7.3): the server owns the countdown, so GO (`race.t0`)
 * is an instant on the server's clock. These helpers are pure; the binder reads the device clock and
 * passes it in. The first offset comes from `welcome.serverNow`; each welcome's `ping`/`pong` round
 * refines it (#643, `pongOffset`, `bestOffset`).
 */

/** The offset that turns this device's clock into the server's: server time = local time + offset. */
export function clockOffset(serverNow: number, receivedAt: number): number {
  return serverNow - receivedAt;
}

/** Milliseconds from `now` (server clock) until `t0`, never negative: a timer delay. */
export function remainingTo(t0: number, now: number): number {
  return Math.max(0, t0 - now);
}

/** One `pong` as the binder saw it: the ping's send time, the server's clock, this device's receipt time. */
export type PongSample = { sent: number; serverNow: number; receivedAt: number };

/**
 * The offset one `pong` gives (#643): the server read its clock half way through the round trip, so
 * server time = midpoint of `sent` and `receivedAt` + offset.
 */
export function pongOffset(sent: number, serverNow: number, receivedAt: number): number {
  return serverNow - (sent + receivedAt) / 2;
}

/**
 * The offset of the sample with the smallest round trip (`receivedAt - sent`, the least room for an
 * asymmetric path); the first one on a tie; `null` without a sample.
 */
export function bestOffset(samples: readonly PongSample[]): number | null {
  let best: PongSample | null = null;
  for (const s of samples)
    if (!best || s.receivedAt - s.sent < best.receivedAt - best.sent) best = s;
  return best && pongOffset(best.sent, best.serverNow, best.receivedAt);
}
