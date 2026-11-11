import { io as realIo } from "socket.io-client";
import {
  abandonSchema,
  bonusPlaySchema,
  clientAcks,
  keysSchema,
  pingSchema,
  PROTOCOL_VERSION,
  rejectReasonSchema,
  serverEvents,
  type HostKickAck,
  type HostSettingsAck,
  type HostStartAck,
  type Keys,
  type RaceSettingsPatch,
  type RejectReason,
} from "@fifth-copy/protocol";
import type { z } from "zod";

/** Server -> client payloads, derived from the protocol: a new event is one schema + one key in `serverEvents`. */
export type RoomEvents = { [K in keyof typeof serverEvents]: z.infer<(typeof serverEvents)[K]> };

/** Handshake refusals from the race server, plus `transport` for anything else (network, timeout). */
export type ConnectErrorReason = RejectReason | "transport";

/** A server payload or a server acknowledgement that failed its protocol schema. */
export type ProtocolError = {
  event: keyof RoomEvents | keyof typeof clientAcks;
  issues: z.core.$ZodIssue[];
};

/** The ack of `host:settings`, or `timeout` when none (or an invalid one) arrived in time. */
export type HostSettingsResult = HostSettingsAck | { ok: false; error: "timeout" };

/** How long `sendHostSettings` waits for the server's acknowledgement. */
export const HOST_SETTINGS_TIMEOUT_MS = 5_000;

/** The ack of `host:start` (`{ ok: true, raceId }` or a refusal), or `timeout` (#214 C7). */
export type HostStartResult = HostStartAck | { ok: false; error: "timeout" };

/** How long `sendHostStart` waits for the server's acknowledgement. */
export const HOST_START_TIMEOUT_MS = 5_000;

/** The ack of `host:kick` (#133), or `timeout` when none (or an invalid one) arrived in time. */
export type HostKickResult = HostKickAck | { ok: false; error: "timeout" };

/** How long `sendHostKick` waits for the server's acknowledgement. */
export const HOST_KICK_TIMEOUT_MS = 5_000;

/** Removes the one listener an `on*` call registered; calling it again does nothing. */
export type Off = () => void;

/**
 * The only way the web app talks to a race room; the raw socket is never exposed. Every `on*` returns
 * its `Off`, so a binder can unbind exactly what it bound (#561 `bindRaceSocket`).
 */
export interface RoomSocket {
  onWelcome(cb: (payload: RoomEvents["welcome"]) => void): Off;
  onRoster(cb: (payload: RoomEvents["roster"]) => void): Off;
  /** The room's full settings after each host change. */
  onSettings(cb: (payload: RoomEvents["settings"]) => void): Off;
  /** Host only: asks the server to apply `patch`; never rejects. */
  sendHostSettings(patch: RaceSettingsPatch): Promise<HostSettingsResult>;
  /** The host pressed START: the race and its GO instant (`race.t0`, server clock). */
  onCountdown(cb: (payload: RoomEvents["countdown"]) => void): Off;
  /**
   * A public room's automatic start (#814): `startsAt` on the server clock, `null` when dropped. A
   * `countdown` supersedes it.
   */
  onAutoStart(cb: (payload: RoomEvents["auto-start"]) => void): Off;
  /** Host only: asks the server to start the race (#214); never rejects. */
  sendHostStart(): Promise<HostStartResult>;
  /**
   * Host only (#133): asks the server to remove the human at `desk` (`host:kick { v, desk }`); the
   * room hears `event { kind: "kicked" }` and a new `roster`. Never rejects.
   */
  sendHostKick(desk: number): Promise<HostKickResult>;
  /** Your keystrokes since the last batch (#559, <= 50 ms of them); an invalid batch is not sent. */
  sendKeys(batch: Keys["batch"]): void;
  /** The 10 Hz full state of every desk while the race runs (#559). */
  onSnapshot(cb: (payload: RoomEvents["snapshot"]) => void): Off;
  /** A discrete race happening (`overtake`, `passed`, `finished`...: #232, #240), decided by the server. */
  onEvent(cb: (payload: RoomEvents["event"]) => void): Off;
  /** The race is over (`all-finished`, `timer`) or void, with the server's final ranking (#240). */
  onEnded(cb: (payload: RoomEvents["ended"]) => void): Off;
  /** The server refused a `keys`, `abandon` or `bonus:play` (those carry no ack). */
  onRejected(cb: (payload: RoomEvents["rejected"]) => void): Off;
  /**
   * Plays the card your desk holds (#236): `bonus:play { v }`, no ack; the server answers the room with
   * `bonus-sent`, or you with `rejected { no-bonus }`.
   */
  sendBonusPlay(): void;
  /**
   * Leaves the race (#233, spec 4.4): `abandon { v }`, no ack; the server answers the room with
   * `abandoned` for your desk, or you with `rejected { not-running }`.
   */
  sendAbandon(): void;
  /**
   * Clock sync (#643, ARCHITECTURE 7.3): emits `ping { v, sent }`, `sent` = this device's clock
   * (`Date.now()` unless the caller passes its own); the server answers the sender with `pong`.
   */
  sendPing(sent?: number): void;
  /** The server's answer to a `ping`: `sent` echoed, plus its clock (`serverNow`). */
  onPong(cb: (payload: RoomEvents["pong"]) => void): Off;
  onProtocolError(cb: (error: ProtocolError) => void): Off;
  onConnectError(cb: (reason: ConnectErrorReason) => void): Off;
  /**
   * The server closed this socket (`io server disconnect`, #732): socket.io never reconnects it. A
   * join the registry refused after the handshake passed ends this way, before any `welcome`.
   */
  onServerDisconnect(cb: () => void): Off;
  /**
   * The line dropped under this socket (`transport close`, `transport error`, `ping timeout`, `parse
   * error`, #661): socket.io reconnects it by itself, but only fires `reconnect_attempt` after its first
   * delay. Neither the server's close nor this client's own `close()` fires it.
   */
  onTransportDisconnect(cb: () => void): Off;
  onReconnecting(cb: (attempt: number) => void): Off;
  onReconnected(cb: (attempt: number) => void): Off;
  /**
   * Connects this socket again after a handshake refusal (#235 C6: socket.io never retries one on its
   * own), with the token and resume key read afresh; the same socket, so every listener stays bound.
   */
  reconnect(): void;
  /** Removes every listener registered here and disconnects. */
  close(): void;
}

type Listener = (...args: never[]) => void;
type Emitter = {
  on(event: string, fn: Listener): unknown;
  off(event: string, fn: Listener): unknown;
};
/** Untyped view of a socket.io-client socket: payloads stay `unknown` until parsed. */
type RawSocket = Emitter & {
  io: Emitter;
  emit(event: string, payload: unknown, ack?: (raw: unknown) => void): unknown;
  connect(): unknown;
  disconnect(): unknown;
};

/** The handshake `auth` payload (`handshakeAuthSchema` of the protocol). */
export type HandshakeAuthPayload = { v: number; token: string; resumeKey?: string };

/**
 * socket.io calls `auth` before every handshake, the automatic reconnects included, so each one
 * carries the values current at that moment rather than the ones of the first connect.
 */
export type HandshakeAuth = (cb: (payload: HandshakeAuthPayload) => void) => void;

export type IoFactory = (
  url: string,
  opts: {
    auth: HandshakeAuth;
    transports: string[];
    tryAllTransports: boolean;
    autoConnect: boolean;
  },
) => RawSocket;

/**
 * The room socket's transports, in order (ADR 0006: WebSocket first, polling fallback; #442). With
 * `tryAllTransports` a connect attempt whose WebSocket is refused (a school proxy that blocks the
 * upgrade) goes on with long-polling in the same attempt, without any user action; once on polling the
 * client still probes an upgrade, so an open network ends on WebSocket. One constant: the lobby
 * (`late-join.ts`) and the seat share it through `connectToRoom`.
 */
export const ROOM_TRANSPORTS: readonly string[] = ["websocket", "polling"];

/**
 * `resumeKey`: the desk's key from an earlier `welcome` (ARCHITECTURE 7.4); during a race only a
 * handshake carrying it gets the line-cut desk back (#561 C11). Empty or absent sends none. A
 * function is read again before every handshake (#656): a key the first `welcome` stored reaches
 * the reconnects of the same socket.
 */
export type ConnectOptions = {
  version?: number;
  io?: IoFactory;
  resumeKey?: string | null | (() => string | null);
};

/**
 * `token`: the race token, or a function read before every handshake (#235 C6: the seat re-mints an
 * expired token and reconnects the same socket with the new one).
 */
export function connectToRoom(
  url: string,
  token: string | (() => string),
  opts: ConnectOptions = {},
): RoomSocket {
  const io = opts.io ?? (realIo as unknown as IoFactory);
  // ADR 0009: the token and the resume key travel in the handshake auth only, never in the URL or a query.
  const v = opts.version ?? PROTOCOL_VERSION;
  const { resumeKey } = opts;
  const auth: HandshakeAuth = (cb) => {
    const key = typeof resumeKey === "function" ? resumeKey() : resumeKey;
    const current = typeof token === "function" ? token() : token;
    cb(key ? { v, token: current, resumeKey: key } : { v, token: current });
  };
  const socket = io(url, {
    auth,
    transports: [...ROOM_TRANSPORTS],
    tryAllTransports: true,
    autoConnect: true,
  });

  const registered: [Emitter, string, Listener][] = [];
  const protocolErrorListeners = new Set<(error: ProtocolError) => void>();

  function listen(target: Emitter, event: string, fn: Listener): Off {
    target.on(event, fn);
    const entry: [Emitter, string, Listener] = [target, event, fn];
    registered.push(entry);
    return () => {
      const i = registered.indexOf(entry);
      if (i < 0) return;
      registered.splice(i, 1);
      target.off(event, fn);
    };
  }

  function on<K extends keyof RoomEvents>(event: K, cb: (payload: RoomEvents[K]) => void): Off {
    return listen(socket, event, (raw: unknown) => {
      const result = serverEvents[event].safeParse(raw);
      if (result.success) {
        cb(result.data as RoomEvents[K]);
        return;
      }
      reportProtocolError({ event, issues: result.error.issues });
    });
  }

  function reportProtocolError(error: ProtocolError) {
    // Never log the payload or the token: issues only.
    console.warn("[race] dropped invalid payload", error);
    for (const fn of protocolErrorListeners) fn(error);
  }

  /**
   * Emits a client event that carries an ack and resolves the parsed ack, or `timeout` when none (or an
   * invalid one) arrives in time. Never rejects.
   */
  function ask<A>(
    event: keyof typeof clientAcks,
    payload: unknown,
    schema: z.ZodType<A>,
    timeoutMs: number,
  ): Promise<A | { ok: false; error: "timeout" }> {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (result: A | { ok: false; error: "timeout" }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => settle({ ok: false, error: "timeout" }), timeoutMs);
      socket.emit(event, payload, (raw: unknown) => {
        if (settled) return;
        const ack = schema.safeParse(raw);
        if (ack.success) return settle(ack.data);
        reportProtocolError({ event, issues: ack.error.issues });
        settle({ ok: false, error: "timeout" });
      });
    });
  }

  return {
    onWelcome: (cb) => on("welcome", cb),
    onRoster: (cb) => on("roster", cb),
    onSettings: (cb) => on("settings", cb),
    sendHostSettings: (patch) =>
      ask(
        "host:settings",
        { v: PROTOCOL_VERSION, patch },
        clientAcks["host:settings"],
        HOST_SETTINGS_TIMEOUT_MS,
      ),
    onCountdown: (cb) => on("countdown", cb),
    onAutoStart: (cb) => on("auto-start", cb),
    sendHostStart: () =>
      ask("host:start", { v: PROTOCOL_VERSION }, clientAcks["host:start"], HOST_START_TIMEOUT_MS),
    sendHostKick: (desk) =>
      ask(
        "host:kick",
        { v: PROTOCOL_VERSION, desk },
        clientAcks["host:kick"],
        HOST_KICK_TIMEOUT_MS,
      ),
    sendKeys: (batch) => {
      const keys = keysSchema.safeParse({ v: PROTOCOL_VERSION, batch });
      if (keys.success) socket.emit("keys", keys.data);
      else console.warn("[race] dropped an invalid keys batch", keys.error.issues.length);
    },
    onSnapshot: (cb) => on("snapshot", cb),
    onEvent: (cb) => on("event", cb),
    onEnded: (cb) => on("ended", cb),
    onRejected: (cb) => on("rejected", cb),
    sendBonusPlay: () => {
      const play = bonusPlaySchema.safeParse({ v: PROTOCOL_VERSION });
      if (play.success) socket.emit("bonus:play", play.data);
    },
    sendAbandon: () => {
      const abandon = abandonSchema.safeParse({ v: PROTOCOL_VERSION });
      if (abandon.success) socket.emit("abandon", abandon.data);
    },
    sendPing: (sent = Date.now()) => {
      const ping = pingSchema.safeParse({ v: PROTOCOL_VERSION, sent });
      if (ping.success) socket.emit("ping", ping.data);
      else console.warn("[race] dropped an invalid ping", ping.error.issues.length);
    },
    onPong: (cb) => on("pong", cb),
    onProtocolError: (cb) => {
      // a wrapper per call, so the same callback registered twice is removed once per off
      const fn = (error: ProtocolError) => cb(error);
      protocolErrorListeners.add(fn);
      return () => void protocolErrorListeners.delete(fn);
    },
    onConnectError: (cb) =>
      listen(socket, "connect_error", (err: unknown) => {
        const message = err instanceof Error ? err.message : undefined;
        const reason = rejectReasonSchema.safeParse(message);
        cb(reason.success ? reason.data : "transport");
      }),
    onServerDisconnect: (cb) =>
      listen(socket, "disconnect", (reason: unknown) => {
        if (reason === "io server disconnect") cb();
      }),
    onTransportDisconnect: (cb) =>
      listen(socket, "disconnect", (reason: unknown) => {
        if (reason !== "io server disconnect" && reason !== "io client disconnect") cb();
      }),
    onReconnecting: (cb) =>
      listen(socket.io, "reconnect_attempt", (attempt: number) => cb(attempt)),
    onReconnected: (cb) => listen(socket.io, "reconnect", (attempt: number) => cb(attempt)),
    reconnect: () => void socket.connect(),
    close: () => {
      for (const [target, event, fn] of registered.splice(0)) target.off(event, fn);
      protocolErrorListeners.clear();
      socket.disconnect();
    },
  };
}
