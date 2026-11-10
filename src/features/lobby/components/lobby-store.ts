import type { Member, RaceSettings } from "@fifth-copy/protocol";
import type { ConnectErrorReason, Off, RoomEvents, RoomSocket } from "@/features/race";
import type { EntryError } from "./entry-errors";

/** Desks in a waiting room (spec: thirty desks, one message). */
export const ROOM_SEATS = 30;

/**
 * Why the waiting room cannot be shown; each maps to a landing error line. `server-disconnect`: the race
 * server closed a seated viewer's socket (#661), which socket.io never reconnects (the generic line).
 */
export type LobbyError = "not-found" | "closed" | "room-full" | "server-disconnect" | "generic";

/**
 * A public room's automatic start (#814), on the server clock. `at`: the pending instant
 * (`welcome.autoStartAt`, `auto-start.startsAt`), `null` when none. `offset`: server time = device
 * time + offset, from the last `welcome.serverNow` (the race store's recipe, #172). `notice`: the one
 * polite announcement of the last change seen while the page is live (`armed` with the seconds left at
 * arrival, frozen so the live region never ticks; `dropped`), `null` before any.
 */
export type AutoStartState = {
  at: number | null;
  offset: number;
  notice: { kind: "armed"; seconds: number } | { kind: "dropped" } | null;
};

export const NO_AUTO_START: AutoStartState = { at: null, offset: 0, notice: null };

/** Whole seconds until `at` at device time `now` on the offset clock; never below 0; null with none. */
export function autoStartSecondsAt(auto: AutoStartState, now: number): number | null {
  return auto.at === null ? null : Math.max(0, Math.ceil((auto.at - (now + auto.offset)) / 1_000));
}

/** The pending instant moves to `at` (seen at device time `receivedAt`, if known). */
function autoStartTo(auto: AutoStartState, at: number | null, receivedAt?: number): AutoStartState {
  if (at === auto.at) return auto;
  if (at === null) return { ...auto, at, notice: { kind: "dropped" } };
  const seconds = autoStartSecondsAt({ ...auto, at }, receivedAt ?? Date.now()) ?? 0;
  return { ...auto, at, notice: auto.at === null ? { kind: "armed", seconds } : auto.notice };
}

export type LobbyState = {
  /**
   * `starting`: the host pressed START; the page moves to the seat view of `raceId` (#214).
   * `spectating`: a late joiner refused `in-progress` before it was ever seated, held until the race
   * ends (#732, `joinRoom`); extension point for the phone spectator screen (#292) and the projector.
   * `removed`: the host removed this viewer (#133, `kicked` for its desk or a `connect_error removed`);
   * terminal like `error`, the page shows the removed docket.
   */
  phase: "loading" | "live" | "reconnecting" | "starting" | "spectating" | "removed" | "error";
  error: LobbyError | null;
  /** The viewer's desk, from `welcome`. */
  you: number | null;
  /** Sorted by desk. */
  members: Member[];
  /** The started race (`countdown.race.raceId`, the stored `Race.id`), `null` before the start. */
  raceId: string | null;
  /**
   * The room's race settings (#498): from `welcome.settings`, replaced whole by every `settings`
   * broadcast (ADR 0006: the client's only source); `null` until the first welcome.
   */
  settings: RaceSettings | null;
  /** The public room's automatic start (#814). */
  autoStart: AutoStartState;
};

/**
 * Everything the waiting room reacts to. Extension point (card 108, card 169, race HUD): one event here,
 * one case in `reduceLobby`, one binding in `bindRoomSocket`.
 */
export type LobbyEvent =
  /** `receivedAt`: the device clock when it arrived (the binder's), for the clock offset (#814). */
  | { type: "welcome"; payload: RoomEvents["welcome"]; receivedAt?: number }
  | { type: "auto-start"; payload: RoomEvents["auto-start"]; receivedAt?: number }
  | { type: "roster"; payload: RoomEvents["roster"] }
  | { type: "settings"; payload: RoomEvents["settings"] }
  | { type: "countdown"; payload: RoomEvents["countdown"] }
  /** A room event (`event`); the lobby reads only `kicked` (#133). */
  | { type: "event"; payload: RoomEvents["event"] }
  | { type: "connect-error"; reason: ConnectErrorReason }
  | { type: "reconnecting" }
  | { type: "reconnected" }
  /** The server closed the socket (`io server disconnect`, #661): final, no reconnect follows. */
  | { type: "server-disconnect" }
  | { type: "token-error"; error: LobbyError };

export const initialLobbyState: LobbyState = {
  phase: "loading",
  error: null,
  you: null,
  members: [],
  raceId: null,
  settings: null,
  autoStart: NO_AUTO_START,
};

const byDesk = (members: Member[]) => [...members].sort((a, b) => a.desk - b.desk);

function connectError(reason: ConnectErrorReason): LobbyError | null {
  switch (reason) {
    case "transport":
      return null;
    case "closed":
      return "closed";
    case "no-room":
      return "not-found";
    case "bad-token":
    // Reached only when the one-shot reload already ran (see `bindRoomSocket`).
    case "version":
    // A viewer seated before (a member refused later): a late joiner holds instead (#732).
    case "in-progress":
      return "generic";
    // Handled before: the terminal `removed` phase (#133).
    case "removed":
      return null;
    // Every desk taken (#732), its own sentence (#678); a spectator past its cap is the late-join
    // hold's, never the store's.
    case "room-full":
      return "room-full";
  }
}

/**
 * The landing error line of a lobby error: a server-side close reads the generic sentence (bible 14.3,
 * the 7.4 inline error line: something jammed), so no new copy.
 */
export function lobbyErrorCopy(error: LobbyError | null): EntryError {
  return error === null || error === "server-disconnect" ? "generic" : error;
}

export function reduceLobby(state: LobbyState, event: LobbyEvent): LobbyState {
  // An error is terminal: the room refused this viewer, nothing later revives the page. So is a removal
  // by the host (#133): no reconnect, no late-join hold.
  if (state.phase === "error" || state.phase === "removed") return state;
  switch (event.type) {
    case "welcome": {
      // A welcome after START (a reload or a reconnect during the countdown, #659) carries the race:
      // the same state a `countdown` would give, so the page still moves to the seat view.
      const { room, race } = event.payload;
      const underway = room.phase === "countdown" || room.phase === "running";
      const started = underway && race !== null;
      const { receivedAt } = event;
      const offset =
        receivedAt === undefined ? state.autoStart.offset : event.payload.serverNow - receivedAt;
      return {
        // A START racing the join can leave `race` out: a page already starting stays starting.
        phase: started || (underway && state.phase === "starting") ? "starting" : "live",
        error: null,
        you: event.payload.you,
        members: byDesk(event.payload.members),
        raceId: started ? race.raceId : state.raceId,
        settings: event.payload.settings,
        autoStart: autoStartTo(
          { ...state.autoStart, offset },
          event.payload.autoStartAt,
          receivedAt,
        ),
      };
    }
    case "auto-start": {
      const autoStart = autoStartTo(state.autoStart, event.payload.startsAt, event.receivedAt);
      return autoStart === state.autoStart ? state : { ...state, autoStart };
    }
    case "roster":
      return { ...state, members: byDesk(event.payload.members) };
    case "settings":
      return { ...state, settings: event.payload.settings };
    case "countdown":
      return { ...state, phase: "starting", raceId: event.payload.race.raceId };
    case "event": {
      const { payload } = event;
      // Another desk's removal: the roster broadcast drops its row.
      if (payload.kind !== "kicked" || payload.desk !== state.you) return state;
      return { ...state, phase: "removed", error: null };
    }
    case "connect-error": {
      const { reason } = event;
      if (reason === "removed") return { ...state, phase: "removed", error: null };
      // A late joiner (#732): refused before its first seat, it holds until the race ends; transport
      // errors keep the notice, a full room ends it. A viewer seated before keeps today's path.
      const neverSeated = state.you === null && state.phase !== "starting";
      if (reason === "in-progress" && neverSeated) return { ...state, phase: "spectating" };
      if (state.phase === "spectating" && reason === "transport") return state;
      const error = connectError(reason);
      return error ? { ...state, phase: "error", error } : { ...state, phase: "reconnecting" };
    }
    case "reconnecting":
      return state.phase === "spectating" ? state : { ...state, phase: "reconnecting" };
    case "reconnected":
      if (state.phase === "spectating") return state;
      return { ...state, phase: state.you === null ? "loading" : "live" };
    case "server-disconnect": {
      // Never seated (loading, spectating): a join refused after the handshake, the late-join hold's
      // to decide (#732). Seated: the page would wait forever, so it ends on the error line.
      const neverSeated = state.you === null && state.phase !== "starting";
      if (neverSeated || state.phase === "spectating") return state;
      return { ...state, phase: "error", error: "server-disconnect" };
    }
    case "token-error":
      return { ...state, phase: "error", error: event.error };
  }
}

/**
 * One-shot marker for the version-skew reload (ADR 0006 point 4): set in `sessionStorage` just before the
 * reload, so a second `version` refusal after it shows the generic error instead of looping; a `welcome`
 * clears it.
 */
export const VERSION_RELOAD_KEY = "fifth-copy:version-reload";

/** The side effects of the version-skew reload, injected so unit tests never touch `window`. */
export type VersionReload = {
  reload: () => void;
  /** `null` when storage is unavailable: then the page never reloads, so it cannot loop. */
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
};

function browserVersionReload(): VersionReload {
  let storage: VersionReload["storage"] = null;
  try {
    storage = window.sessionStorage;
  } catch {
    // Blocked site data: no marker, so no reload.
  }
  return { reload: () => window.location.reload(), storage };
}

/** Sets the marker and reloads, unless the marker is already set or cannot be set. */
function tryVersionReload({ reload, storage }: VersionReload): boolean {
  try {
    if (!storage || storage.getItem(VERSION_RELOAD_KEY) !== null) return false;
    storage.setItem(VERSION_RELOAD_KEY, "1");
  } catch {
    return false;
  }
  reload();
  return true;
}

export type BindRoomSocketOptions = {
  /** The room's lobby id: each `welcome.resumeKey` is stored under it, for the seat view (#214). */
  lobbyId?: string;
  /**
   * The race feature's `storeResumeKey` (#561), handed in from the lazily loaded race module (card 536:
   * the lobby never imports a value of `@/features/race` statically).
   */
  storeResumeKey?: (lobbyId: string, key: string) => void;
  versionReload?: VersionReload;
  /** The device clock stamped on `welcome` and `auto-start` (#814); `Date.now` by default. */
  now?: () => number;
};

/**
 * Subscribes the room socket's events and turns them into lobby events; returns the unbind, which offs
 * every listener bound here (the waiting room unbinds before it parks the socket for the seat view, #214).
 * Every `welcome` stores its resume key for the lobby. A first `version` refusal reloads the page to fetch
 * the bundle of the new `PROTOCOL_VERSION` instead of dispatching an error.
 */
export function bindRoomSocket(
  socket: RoomSocket,
  dispatch: (event: LobbyEvent) => void,
  {
    lobbyId,
    storeResumeKey,
    versionReload = browserVersionReload(),
    now = Date.now,
  }: BindRoomSocketOptions = {},
): Off {
  let reloading = false;
  const offs: Off[] = [
    socket.onWelcome((payload) => {
      try {
        versionReload.storage?.removeItem(VERSION_RELOAD_KEY);
      } catch {
        // Storage went away: nothing to clear.
      }
      if (lobbyId && payload.resumeKey) storeResumeKey?.(lobbyId, payload.resumeKey);
      dispatch({ type: "welcome", payload, receivedAt: now() });
    }),
    socket.onRoster((payload) => dispatch({ type: "roster", payload })),
    socket.onSettings((payload) => dispatch({ type: "settings", payload })),
    socket.onCountdown((payload) => dispatch({ type: "countdown", payload })),
    socket.onEvent((payload) => {
      if (payload.kind === "kicked") dispatch({ type: "event", payload });
    }),
    socket.onAutoStart((payload) => dispatch({ type: "auto-start", payload, receivedAt: now() })),
    socket.onConnectError((reason) => {
      if (reloading) return;
      if (reason === "version" && tryVersionReload(versionReload)) {
        reloading = true;
        return;
      }
      dispatch({ type: "connect-error", reason });
    }),
    socket.onReconnecting(() => dispatch({ type: "reconnecting" })),
    socket.onReconnected(() => dispatch({ type: "reconnected" })),
    socket.onServerDisconnect(() => dispatch({ type: "server-disconnect" })),
  ];
  return () => {
    for (const off of offs.splice(0)) off();
  };
}
