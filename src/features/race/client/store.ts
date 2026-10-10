import type { Member, Phase, Welcome } from "@fifth-copy/protocol";
import { storeResumeKey } from "./resume-key";
import type { ConnectErrorReason, Off, RoomEvents, RoomSocket } from "./socket";

/**
 * The race store (#561, ADR 0013 "two features, one store"): everything the seat view knows about its
 * room, in one place the HTML HUD reads today and the 3D scene (#563) reads later. The reducer is pure
 * and holds no race rule (ADR 0007: ranks, progress and WPM arrive from the server).
 * React reads it through `useRaceStore` (`use-race-store.ts`); this module has no React in it.
 */

/** `connecting` until the first `welcome`; then the room's own phase; `lost` is terminal. */
export type RacePhase = "connecting" | Phase | "reconnecting" | "lost";

/** Why the mint of the race token failed (`mintRaceToken`), or `generic` for a failed request. */
export type RaceTokenError = "not-found" | "closed" | "generic";

/** Why the page gave up: a handshake refusal (`transport` only reconnects) or a token error. */
export type RaceLostReason = Exclude<ConnectErrorReason, "transport"> | RaceTokenError;

export type RaceState = {
  phase: RacePhase;
  lost: RaceLostReason | null;
  /** Kept from `welcome` (#214, #559, #232, #240 read them). */
  room: Welcome["room"] | null;
  role: Welcome["role"] | null;
  /** Your desk; `null` before the welcome and for a spectator. */
  you: Welcome["you"];
  /** Sorted by desk. */
  members: Member[];
  settings: Welcome["settings"] | null;
  race: Welcome["race"];
  state: Welcome["state"];
  overlay: Welcome["overlay"];
  resumeKey: Welcome["resumeKey"];
  /** The server clock at the welcome (the first clock offset, #172). */
  serverNow: Welcome["serverNow"] | null;
};

/**
 * Everything the seat view reacts to. Extension point (countdown #214, snapshot #559, event #232,
 * ended #240, abandon and idle #233, line-cut #235): one event here, one case in `reduceRace`, one
 * binding in `bindRaceSocket`.
 */
export type RaceEvent =
  | { type: "welcome"; payload: RoomEvents["welcome"] }
  | { type: "roster"; payload: RoomEvents["roster"] }
  | { type: "connect-error"; reason: ConnectErrorReason }
  | { type: "reconnecting" }
  | { type: "reconnected" }
  | { type: "token-error"; error: RaceTokenError };

export const initialRaceState: RaceState = {
  phase: "connecting",
  lost: null,
  room: null,
  role: null,
  you: null,
  members: [],
  settings: null,
  race: null,
  state: null,
  overlay: null,
  resumeKey: null,
  serverNow: null,
};

const byDesk = (members: readonly Member[]) => [...members].sort((a, b) => a.desk - b.desk);

const lost = (state: RaceState, reason: RaceLostReason): RaceState => ({
  ...state,
  phase: "lost",
  lost: reason,
});

export function reduceRace(state: RaceState, event: RaceEvent): RaceState {
  // Lost is terminal: the room refused this viewer and nothing later revives the page (the lost line
  // links back to the waiting room).
  if (state.phase === "lost") return state;
  switch (event.type) {
    case "welcome": {
      const w = event.payload;
      return {
        phase: w.room.phase,
        lost: null,
        room: w.room,
        role: w.role,
        you: w.you,
        members: byDesk(w.members),
        settings: w.settings,
        race: w.race,
        state: w.state,
        overlay: w.overlay,
        resumeKey: w.resumeKey,
        serverNow: w.serverNow,
      };
    }
    case "roster":
      return { ...state, members: byDesk(event.payload.members) };
    case "connect-error":
      // `transport` (network, timeout): socket.io keeps retrying; any refusal is final
      return event.reason === "transport"
        ? { ...state, phase: "reconnecting" }
        : lost(state, event.reason);
    case "reconnecting":
      return { ...state, phase: "reconnecting" };
    case "reconnected":
      // the fresh `welcome` that follows a reconnect sets the real phase
      return { ...state, phase: state.room?.phase ?? "connecting" };
    case "token-error":
      return lost(state, event.error);
  }
}

export type RaceStore = {
  getState(): RaceState;
  /** Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  dispatch(event: RaceEvent): void;
};

/** A tiny external store (ADR 0013: plain React state through `useSyncExternalStore`, no library). */
export function createRaceStore(initial: RaceState = initialRaceState): RaceStore {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    dispatch(event) {
      const next = reduceRace(state, event);
      if (next === state) return;
      state = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

export type BindRaceSocketOptions = {
  /** The room's lobby id: each `welcome.resumeKey` is stored under it (#561 C11). */
  lobbyId?: string;
};

/**
 * Subscribes the room socket's events and turns them into race events; returns the unbind, which offs
 * every listener bound here (and only those). Every `welcome` stores its resume key for this lobby, so
 * the next page (a reload, the seat view after the lobby) can reclaim the desk.
 */
export function bindRaceSocket(
  socket: RoomSocket,
  dispatch: (event: RaceEvent) => void,
  { lobbyId }: BindRaceSocketOptions = {},
): Off {
  const offs: Off[] = [
    socket.onWelcome((payload) => {
      if (lobbyId && payload.resumeKey) storeResumeKey(lobbyId, payload.resumeKey);
      dispatch({ type: "welcome", payload });
    }),
    socket.onRoster((payload) => dispatch({ type: "roster", payload })),
    socket.onConnectError((reason) => dispatch({ type: "connect-error", reason })),
    socket.onReconnecting(() => dispatch({ type: "reconnecting" })),
    socket.onReconnected(() => dispatch({ type: "reconnected" })),
  ];
  return () => {
    for (const off of offs.splice(0)) off();
  };
}
