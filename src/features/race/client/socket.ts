import { io as realIo } from "socket.io-client";
import {
  PROTOCOL_VERSION,
  rejectReasonSchema,
  serverEvents,
  type RejectReason,
} from "@fifth-copy/protocol";
import type { z } from "zod";

/** Server -> client payloads, derived from the protocol: a new event is one schema + one key in `serverEvents`. */
export type RoomEvents = { [K in keyof typeof serverEvents]: z.infer<(typeof serverEvents)[K]> };

/** Handshake refusals from the race server, plus `transport` for anything else (network, timeout). */
export type ConnectErrorReason = RejectReason | "transport";

export type ProtocolError = { event: keyof RoomEvents; issues: z.core.$ZodIssue[] };

/** The only way the web app talks to a race room; the raw socket is never exposed. */
export interface RoomSocket {
  onWelcome(cb: (payload: RoomEvents["welcome"]) => void): void;
  onRoster(cb: (payload: RoomEvents["roster"]) => void): void;
  onProtocolError(cb: (error: ProtocolError) => void): void;
  onConnectError(cb: (reason: ConnectErrorReason) => void): void;
  onReconnecting(cb: (attempt: number) => void): void;
  onReconnected(cb: (attempt: number) => void): void;
  /** Removes every listener registered here and disconnects. */
  close(): void;
}

type Listener = (...args: never[]) => void;
type Emitter = {
  on(event: string, fn: Listener): unknown;
  off(event: string, fn: Listener): unknown;
};
/** Untyped view of a socket.io-client socket: payloads stay `unknown` until parsed. */
type RawSocket = Emitter & { io: Emitter; disconnect(): unknown };

export type IoFactory = (
  url: string,
  opts: { auth: { v: number; token: string }; transports: string[]; autoConnect: boolean },
) => RawSocket;

export type ConnectOptions = { version?: number; io?: IoFactory };

export function connectToRoom(url: string, token: string, opts: ConnectOptions = {}): RoomSocket {
  const io = opts.io ?? (realIo as unknown as IoFactory);
  // ADR 0009: the token travels in the handshake auth only, never in the URL.
  const socket = io(url, {
    auth: { v: opts.version ?? PROTOCOL_VERSION, token },
    transports: ["websocket", "polling"],
    autoConnect: true,
  });

  const registered: [Emitter, string, Listener][] = [];
  const protocolErrorListeners = new Set<(error: ProtocolError) => void>();

  function listen(target: Emitter, event: string, fn: Listener) {
    target.on(event, fn);
    registered.push([target, event, fn]);
  }

  function on<K extends keyof RoomEvents>(event: K, cb: (payload: RoomEvents[K]) => void) {
    listen(socket, event, (raw: unknown) => {
      const result = serverEvents[event].safeParse(raw);
      if (result.success) {
        cb(result.data as RoomEvents[K]);
        return;
      }
      const error: ProtocolError = { event, issues: result.error.issues };
      // Never log the payload or the token: issues only.
      console.warn("[race] dropped invalid payload", error);
      for (const fn of protocolErrorListeners) fn(error);
    });
  }

  return {
    onWelcome: (cb) => on("welcome", cb),
    onRoster: (cb) => on("roster", cb),
    onProtocolError: (cb) => {
      protocolErrorListeners.add(cb);
    },
    onConnectError: (cb) =>
      listen(socket, "connect_error", (err: unknown) => {
        const message = err instanceof Error ? err.message : undefined;
        const reason = rejectReasonSchema.safeParse(message);
        cb(reason.success ? reason.data : "transport");
      }),
    onReconnecting: (cb) =>
      listen(socket.io, "reconnect_attempt", (attempt: number) => cb(attempt)),
    onReconnected: (cb) => listen(socket.io, "reconnect", (attempt: number) => cb(attempt)),
    close: () => {
      for (const [target, event, fn] of registered.splice(0)) target.off(event, fn);
      protocolErrorListeners.clear();
      socket.disconnect();
    },
  };
}
