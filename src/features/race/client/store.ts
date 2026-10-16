import type { Member, Phase, Welcome } from "@fifth-copy/protocol";
import { clockOffset, remainingTo } from "./clock";
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
  /** Server time = `Date.now()` + this (#214, `clockOffset` of the last welcome; 0 until one). */
  clockOffset: number;
};

/**
 * Everything the seat view reacts to. Extension point (countdown #214, snapshot #559, event #232,
 * ended #240, abandon and idle #233, line-cut #235): one event here, one case in `reduceRace`, one
 * binding in `bindRaceSocket`.
 */
export type RaceEvent =
  /** `receivedAt`: this device's clock when it arrived (the binder's timer), for the clock offset. */
  | { type: "welcome"; payload: RoomEvents["welcome"]; receivedAt?: number }
  | { type: "roster"; payload: RoomEvents["roster"] }
  /** The host started: the race and its GO instant (#214). */
  | { type: "countdown"; payload: RoomEvents["countdown"] }
  /** `race.t0` passed on the corrected clock (scheduled by `bindRaceSocket`, #214). */
  | { type: "go" }
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
  clockOffset: 0,
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
        clockOffset:
          event.receivedAt === undefined
            ? state.clockOffset
            : clockOffset(w.serverNow, event.receivedAt),
      };
    }
    case "roster":
      return { ...state, members: byDesk(event.payload.members) };
    case "countdown":
      return {
        ...state,
        phase: "countdown",
        race: event.payload.race,
        room: state.room && { ...state.room, phase: "countdown" },
      };
    case "go":
      // GO only ends a countdown; a cut line keeps reconnecting and its fresh welcome lands running
      if (state.room?.phase !== "countdown") return state;
      return {
        ...state,
        phase: state.phase === "countdown" ? "running" : state.phase,
        room: { ...state.room, phase: "running" },
      };
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

/** The device clock and timers `bindRaceSocket` schedules GO with (injected in tests). */
export type RaceTimer = {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

const deviceTimer: RaceTimer = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export type BindRaceSocketOptions = {
  /** The room's lobby id: each `welcome.resumeKey` is stored under it (#561 C11). */
  lobbyId?: string;
  timer?: RaceTimer;
};

/**
 * Subscribes the room socket's events and turns them into race events; returns the unbind, which offs
 * every listener bound here (and only those) and cancels a pending GO. Every `welcome` stores its resume
 * key for this lobby, so the next page (a reload, the seat view after the lobby) can reclaim the desk,
 * and sets the clock offset. GO is scheduled at `race.t0` on the corrected clock from a `countdown`, or
 * from a `welcome` that finds the room counting down (the seat view connects after the broadcast, #214).
 */
export function bindRaceSocket(
  socket: RoomSocket,
  dispatch: (event: RaceEvent) => void,
  { lobbyId, timer = deviceTimer }: BindRaceSocketOptions = {},
): Off {
  let offset = 0;
  let pendingGo: unknown = null;
  const cancelGo = () => {
    if (pendingGo !== null) timer.clearTimeout(pendingGo);
    pendingGo = null;
  };
  const scheduleGo = (t0: number) => {
    cancelGo();
    pendingGo = timer.setTimeout(
      () => {
        pendingGo = null;
        dispatch({ type: "go" });
      },
      remainingTo(t0, timer.now() + offset),
    );
  };
  const offs: Off[] = [
    socket.onWelcome((payload) => {
      const receivedAt = timer.now();
      offset = clockOffset(payload.serverNow, receivedAt);
      if (lobbyId && payload.resumeKey) storeResumeKey(lobbyId, payload.resumeKey);
      dispatch({ type: "welcome", payload, receivedAt });
      if (payload.room.phase === "countdown" && payload.race) scheduleGo(payload.race.t0);
      else cancelGo();
    }),
    socket.onRoster((payload) => dispatch({ type: "roster", payload })),
    socket.onCountdown((payload) => {
      dispatch({ type: "countdown", payload });
      scheduleGo(payload.race.t0);
    }),
    socket.onConnectError((reason) => dispatch({ type: "connect-error", reason })),
    socket.onReconnecting(() => dispatch({ type: "reconnecting" })),
    socket.onReconnected(() => dispatch({ type: "reconnected" })),
  ];
  return () => {
    cancelGo();
    for (const off of offs.splice(0)) off();
  };
}
