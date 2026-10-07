import type { Member } from "@fifth-copy/protocol";
import type { ConnectErrorReason, RoomEvents, RoomSocket } from "@/features/race";

/** Desks in a waiting room (spec: thirty desks, one message). */
export const ROOM_SEATS = 30;

/** Why the waiting room cannot be shown; each maps to a landing error line. */
export type LobbyError = "not-found" | "closed" | "generic";

export type LobbyState = {
  phase: "loading" | "live" | "reconnecting" | "error";
  error: LobbyError | null;
  /** The viewer's desk, from `welcome`. */
  you: number | null;
  /** Sorted by desk. */
  members: Member[];
};

/**
 * Everything the waiting room reacts to. Extension point (card 108, card 169, race HUD): one event here,
 * one case in `reduceLobby`, one binding in `bindRoomSocket`.
 */
export type LobbyEvent =
  | { type: "welcome"; payload: RoomEvents["welcome"] }
  | { type: "roster"; payload: RoomEvents["roster"] }
  | { type: "connect-error"; reason: ConnectErrorReason }
  | { type: "reconnecting" }
  | { type: "reconnected" }
  | { type: "token-error"; error: LobbyError };

export const initialLobbyState: LobbyState = {
  phase: "loading",
  error: null,
  you: null,
  members: [],
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
    case "welcome":
      return {
        phase: "live",
        error: null,
        you: event.payload.you,
        members: byDesk(event.payload.members),
      };
    case "roster":
      return { ...state, members: byDesk(event.payload.members) };
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

/** Subscribes the room socket's events and turns them into lobby events. */
export function bindRoomSocket(socket: RoomSocket, dispatch: (event: LobbyEvent) => void) {
  socket.onWelcome((payload) => dispatch({ type: "welcome", payload }));
  socket.onRoster((payload) => dispatch({ type: "roster", payload }));
  socket.onConnectError((reason) => dispatch({ type: "connect-error", reason }));
  socket.onReconnecting(() => dispatch({ type: "reconnecting" }));
  socket.onReconnected(() => dispatch({ type: "reconnected" }));
}
