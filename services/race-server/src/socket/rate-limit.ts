// Per-socket rate limits and payload cap on the client events (#207, ADR 0006 point 7, ADR 0020).
// Leaf module: `attachRateLimit` installs one Socket.IO packet middleware on a socket, ahead of every
// handler, so a refused message never reaches a schema, the registry's per-room queue or the race.
// Counting goes through the shared Redis limiter (`@fifth-copy/limiter`); the refusal count that
// disconnects a flooding socket is process-local (the socket lives on this process).
import { PROTOCOL_VERSION, type ClientToServerEvents } from "@fifth-copy/protocol";
import type { Limiter, LimitRule } from "@fifth-copy/limiter";
import type { Clock } from "../clock";

/** Prefix of the race server's limiter keys: `race:rl:sock:<socket id>:<event>` (ADR 0020). */
export const RACE_LIMITER_PREFIX = "race";

/**
 * One bucket per client event and socket. `keys`: 25 batches a second (a client batches <= 50 ms of
 * keys, so 20 a second, plus slack; each batch holds at most `MAX_KEYS_PER_BATCH` keys, bounded by
 * the protocol schema). `ping`: 2 a second (clock sync, #172). Host and race actions: 5 per 10 s.
 */
export const SOCKET_LIMITS = {
  keys: { max: 25, windowMs: 1_000 },
  ping: { max: 2, windowMs: 1_000 },
  "host:start": { max: 5, windowMs: 10_000 },
  "host:settings": { max: 5, windowMs: 10_000 },
  abandon: { max: 5, windowMs: 10_000 },
  "bonus:play": { max: 5, windowMs: 10_000 },
} as const satisfies Record<keyof ClientToServerEvents, LimitRule>;

/** Any client message larger than this (JSON bytes, estimated without serialising) is refused. */
export const MAX_PAYLOAD_BYTES = 4 * 1024;
/** Refusals within `REFUSAL_WINDOW_MS` that disconnect the socket. */
export const REFUSALS_TO_DISCONNECT = 3;
export const REFUSAL_WINDOW_MS = 10_000;

/**
 * True when `value`, serialised as JSON, would exceed `limit` bytes. Walks the value and stops as
 * soon as the running estimate passes the limit, so a huge payload costs at most ~`limit` steps.
 * Strings count their UTF-8 bytes plus quotes, numbers their digits, binary attachments their
 * length; functions (the Socket.IO ack) count nothing.
 */
export function exceedsBytes(value: unknown, limit: number = MAX_PAYLOAD_BYTES): boolean {
  let total = 0;
  const over = () => total > limit;
  const walk = (v: unknown): boolean => {
    if (v === null || v === undefined) total += 4;
    else if (typeof v === "string") {
      // A string longer than the limit is over whatever its encoding.
      total += v.length > limit ? v.length : Buffer.byteLength(v, "utf8") + 2;
    } else if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") {
      total += String(v).length;
    } else if (typeof v === "function" || typeof v === "symbol") return false;
    else if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer) total += v.byteLength;
    else if (Array.isArray(v)) {
      total += 2;
      for (const item of v) {
        total += 1;
        if (over() || walk(item)) return true;
      }
    } else if (typeof v === "object") {
      total += 2;
      for (const key in v) {
        if (!Object.hasOwn(v, key)) continue;
        total += key.length + 4;
        if (over() || walk((v as Record<string, unknown>)[key])) return true;
      }
    }
    return over();
  };
  return walk(value);
}

/** The slice of a Socket.IO server socket the middleware uses (a fake one in unit tests). */
export type GuardedSocket = {
  id: string;
  readonly disconnected: boolean;
  use(fn: (packet: unknown[], next: (err?: Error) => void) => void): unknown;
  emit(event: "rejected", payload: { v: typeof PROTOCOL_VERSION; reason: "rate-limit" }): unknown;
  disconnect(close: boolean): unknown;
};

export type RateLimitDeps = {
  limiter: Limiter;
  clock: Clock;
  log: (msg: string, fields: Record<string, unknown>) => void;
};

/**
 * Installs the guard on `socket` (call it first in `connection`, before any handler). Each client
 * event is checked in order: payload over `MAX_PAYLOAD_BYTES` -> refused before any parsing; event
 * over its `SOCKET_LIMITS` bucket -> refused. A refused message is dropped and answered with
 * `rejected { reason: "rate-limit" }`; the `REFUSALS_TO_DISCONNECT`th refusal within
 * `REFUSAL_WINDOW_MS` disconnects the socket with one log line (socket id, lobby, count; never the
 * payload). Fails closed: when Redis cannot answer, the message is dropped (logged once per socket)
 * without counting as a refusal. Unknown event names only meet the payload cap: no handler runs them.
 */
export function attachRateLimit(socket: GuardedSocket, lobby: string, deps: RateLimitDeps): void {
  const refusals: number[] = [];
  let unavailableLogged = false;

  let cut = false;

  const refuse = () => {
    if (cut || socket.disconnected) return;
    socket.emit("rejected", { v: PROTOCOL_VERSION, reason: "rate-limit" });
    const now = deps.clock.now();
    refusals.push(now);
    while (refusals.length && refusals[0]! <= now - REFUSAL_WINDOW_MS) refusals.shift();
    if (refusals.length >= REFUSALS_TO_DISCONNECT) {
      cut = true;
      deps.log("rate-limit disconnect", { socket: socket.id, lobby, count: refusals.length });
      // Socket.IO dispatches an admitted message on the next tick: messages admitted before this
      // refusal still reach their handlers, then the socket closes.
      process.nextTick(() => socket.disconnect(true));
    }
  };

  socket.use((packet, next) => {
    const [event, ...args] = packet;
    if (exceedsBytes(args)) return refuse();
    // Own keys only: an event named `constructor` or `__proto__` is no bucket.
    if (typeof event !== "string" || !Object.hasOwn(SOCKET_LIMITS, event)) return next();
    const rule: LimitRule = SOCKET_LIMITS[event as keyof typeof SOCKET_LIMITS];
    deps.limiter.limit(`sock:${socket.id}:${event}`, rule, deps.clock.now()).then(
      (verdict) => {
        if (cut || socket.disconnected) return;
        if (verdict.ok) next();
        else refuse();
      },
      () => {
        if (unavailableLogged) return;
        unavailableLogged = true;
        deps.log("rate-limit unavailable", { socket: socket.id, lobby });
      },
    );
  });
}
