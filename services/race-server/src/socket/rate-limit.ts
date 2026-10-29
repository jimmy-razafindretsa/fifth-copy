// Rate limits and payload cap on the client events (#207, ADR 0006 point 7, ADR 0020). Leaf module:
// `createSocketGuard` installs one Socket.IO packet middleware per socket, ahead of every handler,
// so a refused message never reaches a schema, the registry's per-room queue or the race. Budgets
// belong to the token's identity, not to a socket: counting goes through the shared Redis limiter
// (`@fifth-copy/limiter`); the socket cap and the refusal count that disconnects a flooding identity
// are process-local (its sockets live on this process).
import { PROTOCOL_VERSION, type ClientToServerEvents } from "@fifth-copy/protocol";
import type { Limiter, LimitRule } from "@fifth-copy/limiter";
import type { Clock } from "../clock";

/**
 * Prefix of the race server's limiter keys: `race:rl:<lobby>:<seat|spectator>:<sub>:<event>`
 * (ADR 0020); `lobby` and `sub` come from the verified race token.
 */
export const RACE_LIMITER_PREFIX = "race";

/**
 * One bucket per client event and identity (all of its sockets). `keys`: 25 batches a second (a client batches <= 50 ms of
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
/** Refusals of one identity within `REFUSAL_WINDOW_MS` that disconnect its sockets. */
export const REFUSALS_TO_DISCONNECT = 3;
export const REFUSAL_WINDOW_MS = 10_000;
/**
 * Open sockets one identity may hold on this process: two tabs plus a reconnection that overlaps
 * its stale predecessor (until the transport notices). One more is refused and closed.
 */
export const MAX_SOCKETS_PER_USER = 4;

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

/** The slice of a Socket.IO server socket the guard uses (a fake one in unit tests). */
export type GuardedSocket = {
  id: string;
  readonly disconnected: boolean;
  use(fn: (packet: unknown[], next: (err?: Error) => void) => void): unknown;
  emit(event: "rejected", payload: { v: typeof PROTOCOL_VERSION; reason: "rate-limit" }): unknown;
  disconnect(close: boolean): unknown;
  once(event: "disconnect", listener: () => void): unknown;
};

/** Whose budget a socket spends: the verified race token's room, `sub` and role. */
export type SocketIdentity = { lobby: string; sub: string; role: string };

export type RateLimitDeps = {
  limiter: Limiter;
  clock: Clock;
  log: (msg: string, fields: Record<string, unknown>) => void;
};

export type SocketGuard = {
  /**
   * Installs the guard on `socket` (call it first in `connection`, before any handler). Returns
   * false, after answering `rejected { rate-limit }` and closing the socket, when the identity
   * already holds `MAX_SOCKETS_PER_USER` open sockets on this process.
   */
  admit(socket: GuardedSocket, identity: SocketIdentity): boolean;
  /** Identities the guard currently remembers (tests: the state stays bounded). */
  size(): number;
};

/** A socket's messages still waiting for Redis, and whether it is being cut. */
type SocketState = { pending: number; cut: boolean };

type Tracked = {
  sockets: Map<GuardedSocket, SocketState>;
  /** Times of this identity's refusals, oldest first (pruned to `REFUSAL_WINDOW_MS`). */
  refusals: number[];
  /** Per event: times of the calls admitted locally (counted or being counted by Redis). */
  admitted: Map<string, number[]>;
};

/** Above this many remembered identities, idle ones are swept on the next admission. */
const SWEEP_AT = 256;

/**
 * The race server's per-identity rate limits (ADR 0006 point 7, ADR 0020). One budget per verified
 * identity (room, `sub`, role), shared by all of its sockets on this process and kept in Redis
 * across reconnections, so neither extra tabs nor reconnecting buys more messages. Each client
 * event is checked in order: socket already being cut -> dropped locally; payload over
 * `MAX_PAYLOAD_BYTES` -> refused before any parsing; local count of the event's window already at
 * `max` -> refused without a Redis call; else the shared Redis bucket decides. A refused message
 * is dropped and answered with `rejected { reason: "rate-limit" }`; the `REFUSALS_TO_DISCONNECT`th
 * refusal of the identity within `REFUSAL_WINDOW_MS` disconnects all of its sockets with one log
 * line (socket id, lobby, count; never the payload). Fails closed: when Redis cannot answer, the
 * message is dropped (logged once per socket) without counting as a refusal. Unknown event names
 * only meet the payload cap: no handler runs them.
 */
export function createSocketGuard(deps: RateLimitDeps): SocketGuard {
  const tracked = new Map<string, Tracked>();
  let lastSweep = Number.NEGATIVE_INFINITY;

  const prune = (times: number[], windowMs: number, now: number) => {
    while (times.length && times[0]! <= now - windowMs) times.shift();
  };

  const sweep = (now: number) => {
    if (tracked.size < SWEEP_AT || now - lastSweep < REFUSAL_WINDOW_MS) return;
    lastSweep = now;
    for (const [key, t] of tracked) {
      prune(t.refusals, REFUSAL_WINDOW_MS, now);
      if (t.sockets.size === 0 && t.refusals.length === 0) tracked.delete(key);
    }
  };

  const reject = (socket: GuardedSocket) =>
    socket.emit("rejected", { v: PROTOCOL_VERSION, reason: "rate-limit" });
  // Socket.IO dispatches an admitted message on the next tick: it reaches its handler first.
  const close = (socket: GuardedSocket) => process.nextTick(() => socket.disconnect(true));

  return {
    size: () => tracked.size,

    admit(socket, { lobby, sub, role }) {
      const now = deps.clock.now();
      sweep(now);
      // A spectator token of a host (projector tab) is its own identity: it never spends a desk's budget.
      const id = `${lobby}:${role === "spectator" ? "spectator" : "seat"}:${sub}`;
      let t = tracked.get(id);
      if (!t) tracked.set(id, (t = { sockets: new Map(), refusals: [], admitted: new Map() }));
      const self = t;

      if (self.sockets.size >= MAX_SOCKETS_PER_USER) {
        deps.log("rate-limit socket cap", { socket: socket.id, lobby, sockets: self.sockets.size });
        reject(socket);
        socket.disconnect(true);
        return false;
      }
      const state: SocketState = { pending: 0, cut: false };
      self.sockets.set(socket, state);
      socket.once("disconnect", () => {
        self.sockets.delete(socket);
        prune(self.refusals, REFUSAL_WINDOW_MS, deps.clock.now());
        // Refusals in the window outlive the socket: a reconnection does not reset them.
        if (self.sockets.size === 0 && self.refusals.length === 0) tracked.delete(id);
      });

      let unavailableLogged = false;

      const refuse = () => {
        if (state.cut || socket.disconnected) return;
        reject(socket);
        const at = deps.clock.now();
        self.refusals.push(at);
        prune(self.refusals, REFUSAL_WINDOW_MS, at);
        if (self.refusals.length < REFUSALS_TO_DISCONNECT) return;
        deps.log("rate-limit disconnect", {
          socket: socket.id,
          lobby,
          count: self.refusals.length,
        });
        for (const [s, st] of self.sockets) {
          if (st.cut) continue;
          st.cut = true;
          if (st.pending === 0) close(s);
        }
      };

      socket.use((packet, next) => {
        // Cut (or closed): dropped here, no size walk and no Redis call.
        if (state.cut || socket.disconnected) return;
        const [event, ...args] = packet;
        if (exceedsBytes(args)) return refuse();
        // Own keys only: an event named `constructor` or `__proto__` is no bucket.
        if (typeof event !== "string" || !Object.hasOwn(SOCKET_LIMITS, event)) return next();
        const rule: LimitRule = SOCKET_LIMITS[event as keyof typeof SOCKET_LIMITS];
        const at = deps.clock.now();
        let times = self.admitted.get(event);
        if (!times) self.admitted.set(event, (times = []));
        prune(times, rule.windowMs, at);
        // Already `max` calls of this identity in the window here: Redis would refuse as well.
        if (times.length >= rule.max) return refuse();
        times.push(at);
        const forget = () => {
          const i = times.indexOf(at);
          if (i >= 0) times.splice(i, 1);
        };
        const settled = () => {
          state.pending -= 1;
          if (state.cut && state.pending === 0) close(socket);
        };
        state.pending += 1;
        deps.limiter.limit(`${id}:${event}`, rule, at).then(
          (verdict) => {
            if (!verdict.ok) forget();
            // A message admitted before the cut still reaches its handler; the socket closes after.
            if (verdict.ok && !socket.disconnected) next();
            else if (!verdict.ok) refuse();
            settled();
          },
          () => {
            forget();
            settled();
            if (unavailableLogged) return;
            unavailableLogged = true;
            deps.log("rate-limit unavailable", { socket: socket.id, lobby });
          },
        );
      });
      return true;
    },
  };
}
