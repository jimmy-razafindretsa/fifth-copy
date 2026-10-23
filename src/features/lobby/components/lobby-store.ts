import type { Member } from "@fifth-copy/protocol";
import type { ConnectErrorReason, Off, RoomEvents, RoomSocket } from "@/features/race";

/** Desks in a waiting room (spec: thirty desks, one message). */
export const ROOM_SEATS = 30;

/** Why the waiting room cannot be shown; each maps to a landing error line. */
export type LobbyError = "not-found" | "closed" | "generic";

export type LobbyState = {
  /** `starting`: the host pressed START; the page moves to the seat view of `raceId` (#214). */
  phase: "loading" | "live" | "reconnecting" | "starting" | "error";
  error: LobbyError | null;
  /** The viewer's desk, from `welcome`. */
  you: number | null;
  /** Sorted by desk. */
  members: Member[];
  /** The started race (`countdown.race.raceId`, the stored `Race.id`), `null` before the start. */
  raceId: string | null;
};

/**
 * Everything the waiting room reacts to. Extension point (card 108, card 169, race HUD): one event here,
 * one case in `reduceLobby`, one binding in `bindRoomSocket`.
 */
export type LobbyEvent =
  | { type: "welcome"; payload: RoomEvents["welcome"] }
  | { type: "roster"; payload: RoomEvents["roster"] }
  | { type: "countdown"; payload: RoomEvents["countdown"] }
  | { type: "connect-error"; reason: ConnectErrorReason }
  | { type: "reconnecting" }
  | { type: "reconnected" }
  | { type: "token-error"; error: LobbyError };

export const initialLobbyState: LobbyState = {
  phase: "loading",
  error: null,
  you: null,
  members: [],
  raceId: null,
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
    // No lobby copy for a race already under way yet (#210 adds it).
    case "in-progress":
      return "generic";
  }
}

export function reduceLobby(state: LobbyState, event: LobbyEvent): LobbyState {
  // An error is terminal: the room refused this viewer, nothing later revives the page.
  if (state.phase === "error") return state;
  switch (event.type) {
    case "welcome": {
      // A welcome after START (a reload or a reconnect during the countdown, #659) carries the race:
      // the same state a `countdown` would give, so the page still moves to the seat view.
      const { room, race } = event.payload;
      const underway = room.phase === "countdown" || room.phase === "running";
      const started = underway && race !== null;
      return {
        // A START racing the join can leave `race` out: a page already starting stays starting.
        phase: started || (underway && state.phase === "starting") ? "starting" : "live",
        error: null,
        you: event.payload.you,
        members: byDesk(event.payload.members),
        raceId: started ? race.raceId : state.raceId,
      };
    }
    case "roster":
      return { ...state, members: byDesk(event.payload.members) };
    case "countdown":
      return { ...state, phase: "starting", raceId: event.payload.race.raceId };
    case "connect-error": {
      const error = connectError(event.reason);
      return error ? { ...state, phase: "error", error } : { ...state, phase: "reconnecting" };
    }
    case "reconnecting":
      return { ...state, phase: "reconnecting" };
    case "reconnected":
      return { ...state, phase: state.you === null ? "loading" : "live" };
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
  { lobbyId, storeResumeKey, versionReload = browserVersionReload() }: BindRoomSocketOptions = {},
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
      dispatch({ type: "welcome", payload });
    }),
    socket.onRoster((payload) => dispatch({ type: "roster", payload })),
    socket.onCountdown((payload) => dispatch({ type: "countdown", payload })),
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
  ];
  return () => {
    for (const off of offs.splice(0)) off();
  };
}
