import type { Off, RoomSocket } from "@/features/race";
import type { RaceTokenResult } from "../types";
import type { LobbyEvent } from "./lobby-store";

/**
 * How long a late joiner waits between two player joins when it cannot watch the room (#732): a
 * spectator past the room's cap (`room-full`), a throttled mint. A timer, not a `--motion-*` token.
 * Each retry mints a token, and `mint-race-token` allows 10 a minute per guest: never lower it.
 */
export const LATE_JOIN_RETRY_MS = 10_000;

export type JoinRoomDeps = {
  /** `mintRaceToken({ code, spectator })` (ADR 0009). */
  mint: (opts: { spectator: boolean }) => Promise<RaceTokenResult>;
  /** The lazily loaded `connectToRoom` (ADR 0013): a rejection is a failed chunk load. */
  connect: (url: string, token: string) => Promise<RoomSocket>;
  /**
   * Hands a player socket to the page, which binds the lobby store to it (`bindRoomSocket`) and
   * keeps it for START, the settings and the seat view; returns its unbind. Called before the
   * socket's first event, so the store sees its welcome (and its resume key) and its refusals.
   */
  attach: (socket: RoomSocket) => Off;
  /** The lobby store's dispatch, for what no bound socket reports (mint failures, spectator refusals). */
  dispatch: (event: LobbyEvent) => void;
  retryMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
};

/**
 * The waiting room's connection (#732): a player join, and for a viewer refused `in-progress` (the
 * race already started, spec 5.1) the hold until a seat. The hold watches the room on a read-only
 * spectator socket (#187, ADR 0006 point 8) and, on `ended` (or a spectator welcome of a room no
 * longer racing), closes it and joins as a player again. A spectator refused `room-full` (#616) polls
 * the player join every `retryMs` instead. The store bound by `attach` reports the refusal itself
 * (phase `spectating`); a refused player socket is unbound and closed here, since a middleware
 * refusal never reconnects. A server disconnect before the first welcome (a join refused after the
 * handshake) is held the same way. The hold only reads a player socket's refusals until its first welcome:
 * after that the socket is the page's. The spectator socket never reaches the store (its welcome has
 * `you: null`). Returns the cancel, which never closes an attached socket (the page parks or closes it).
 */
export function joinRoom({
  mint,
  connect,
  attach,
  dispatch,
  retryMs = LATE_JOIN_RETRY_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
}: JoinRoomDeps): () => void {
  let cancelled = false;
  let timer: unknown = null;
  // `room-full`: the room cannot be watched, so the hold polls the player join
  let polling = false;
  let first = true;
  let watcher: { socket: RoomSocket; offs: Off[] } | null = null;
  let pending: Off[] = [];

  const later = (attempt: () => void) => {
    timer = setTimer(() => {
      timer = null;
      if (!cancelled) attempt();
    }, retryMs);
  };

  /** A token and its socket, or `null` when cancelled or refused (then reported or rescheduled). */
  async function open(spectator: boolean, retry: () => void): Promise<RoomSocket | null> {
    const isFirst = first;
    first = false;
    const result = await mint({ spectator }).catch(() => null);
    if (cancelled) return null;
    if (!result?.ok) {
      // Throttled or unreachable during the hold: wait and try again; the first mint keeps the page's
      // errors (a throttled mint is the generic error, #207).
      if (!isFirst && (result === null || result.error === "rate-limited")) later(retry);
      else {
        const error = !result || result.error === "rate-limited" ? "generic" : result.error;
        dispatch({ type: "token-error", error });
      }
      return null;
    }
    const socket = await connect(result.url, result.token).catch(() => null);
    if (cancelled) socket?.close();
    else if (!socket) dispatch({ type: "token-error", error: "generic" });
    return cancelled ? null : socket;
  }

  async function seat() {
    const socket = await open(false, seat);
    if (!socket) return;
    const detach = attach(socket);
    const stop = () => {
      for (const off of pending.splice(0)) off();
    };
    const hold = () => {
      stop();
      detach();
      socket.close();
      if (polling) later(seat);
      else void watch();
    };
    pending = [
      socket.onWelcome(stop),
      socket.onConnectError((reason) => {
        if (cancelled || reason === "transport") return;
        // the bound store reports the refusal; any other reason is its terminal error
        if (reason === "in-progress") hold();
        else stop();
      }),
      // A join the room refused after the handshake (a START racing it, a desk taken meanwhile)
      // closes the socket from the server with no reason and no reconnect: hold as for in-progress.
      socket.onServerDisconnect(() => {
        if (cancelled) return;
        dispatch({ type: "connect-error", reason: "in-progress" });
        hold();
      }),
    ];
  }

  function unwatch() {
    if (!watcher) return;
    for (const off of watcher.offs) off();
    watcher.socket.close();
    watcher = null;
  }

  async function watch() {
    const socket = await open(true, watch);
    if (!socket) return;
    const seatNow = () => {
      if (cancelled || watcher?.socket !== socket) return;
      unwatch();
      void seat();
    };
    watcher = {
      socket,
      offs: [
        socket.onWelcome(({ room }) => {
          if (room.phase === "waiting" || room.phase === "ended") seatNow();
        }),
        socket.onEnded(seatNow),
        // the server closed the watch (the room went away): try the seat again later
        socket.onServerDisconnect(() => {
          if (cancelled || watcher?.socket !== socket) return;
          unwatch();
          later(seat);
        }),
        socket.onConnectError((reason) => {
          // socket.io retries a transport error by itself
          if (reason === "transport" || cancelled || watcher?.socket !== socket) return;
          unwatch();
          // past the spectator cap, or the token expired on a reconnect during a long race
          if (reason === "room-full" || reason === "bad-token") {
            polling = reason === "room-full";
            later(seat);
          } else dispatch({ type: "connect-error", reason });
        }),
      ],
    };
  }

  void seat();
  return () => {
    cancelled = true;
    if (timer !== null) clearTimer(timer);
    timer = null;
    for (const off of pending.splice(0)) off();
    unwatch();
  };
}
