import {
  engineSettingsOf,
  PLAYER_STATUSES,
  type Member,
  type Phase,
  type Snapshot,
  type Welcome,
} from "@fifth-copy/protocol";
import type { LastKey } from "../view/machine-props";
import { NO_TEXT_VIEW, typedViewFrom, type TypedView } from "../view/typed-view";
import { clockOffset, remainingTo } from "./clock";
import {
  createPrediction,
  typedText,
  type Keystroke,
  type PlayerState,
  type Prediction,
} from "./prediction";
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
  /**
   * Your desk's typing (#559, ADR 0007): the engine's state predicted from your keys, reconciled with
   * every snapshot. Built when the race text is known (`countdown`, or a `welcome` with a race); `null`
   * before, and for a spectator.
   */
  prediction: Prediction | null;
  /** The last snapshot's desks `[desk, cursor, correct, errors, statusCode]` and live order (#559). */
  desks: Snapshot["desks"];
  ranks: Snapshot["ranks"];
  /**
   * The last key your prediction took (#220): the struck cap and, later, the press (#224), the sound
   * (#243) and the stuck hint (#241) read it. `null` until a key, and again with each new prediction.
   */
  lastKey: LastKey | null;
};

/**
 * Everything the seat view reacts to. Extension point (countdown #214, key and snapshot #559, event #232,
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
  /** A key typed after GO, `t` in ms since GO on the corrected clock (#559, `createTyping`). */
  | { type: "key"; keystroke: Keystroke }
  /** `count` typed keys left for the race server in one `keys` batch (#559). */
  | { type: "sent"; count: number }
  /** The 10 Hz full state of every desk (#559): kept, and your prediction reconciled with it. */
  | { type: "snapshot"; payload: RoomEvents["snapshot"] }
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
  prediction: null,
  desks: [],
  ranks: [],
  lastKey: null,
};

const byDesk = (members: readonly Member[]) => [...members].sort((a, b) => a.desk - b.desk);

/**
 * Your desk's prediction for a race: its text (with your overlay), the host's error mode and backspace
 * rule (`engineSettingsOf`), from your authoritative state when the server sent one. `null` without a
 * race, a desk or settings (a spectator types nothing).
 */
function predictionOf(
  race: Welcome["race"],
  you: Welcome["you"],
  settings: Welcome["settings"] | null,
  overlay: Welcome["overlay"],
  initial: PlayerState | null,
): Prediction | null {
  if (!race || you === null || !settings) return null;
  return createPrediction({
    text: typedText(race.text, overlay),
    settings: engineSettingsOf(settings),
    initial: initial ?? undefined,
  });
}

/** Your desk in a snapshot as the four numbers the prediction compares. */
function serverProgressOf(desks: Snapshot["desks"], you: number) {
  const mine = desks.find(([desk]) => desk === you);
  if (!mine) return null;
  const [, cursor, correct, errors, code] = mine;
  return { cursor, correct, errors, status: PLAYER_STATUSES[code]! };
}

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
        // a (re)connect starts over from the server's state of your desk
        prediction: predictionOf(w.race, w.you, w.settings, w.overlay, w.state),
        desks: state.desks,
        ranks: state.ranks,
        lastKey: null,
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
        prediction: predictionOf(
          event.payload.race,
          state.you,
          state.settings,
          state.overlay,
          null,
        ),
        desks: [],
        ranks: [],
        lastKey: null,
      };
    case "go":
      // GO only ends a countdown; a cut line keeps reconnecting and its fresh welcome lands running
      if (state.room?.phase !== "countdown") return state;
      return {
        ...state,
        phase: state.phase === "countdown" ? "running" : state.phase,
        room: { ...state.room, phase: "running" },
      };
    case "key": {
      // typing is locked before GO and after your own finish (the engine refuses a key once you stop)
      if (state.phase !== "running" || !state.prediction) return state;
      const prediction = state.prediction.push(event.keystroke);
      if (prediction === state.prediction) return state;
      // the engine's verdict on the key, as the prediction read it (#220): no comparison here
      const { key, t } = event.keystroke;
      return { ...state, prediction, lastKey: { key, t, wrong: prediction.wrong } };
    }
    case "sent": {
      const prediction = state.prediction?.markSent(event.count) ?? null;
      return prediction === state.prediction ? state : { ...state, prediction };
    }
    case "snapshot": {
      const { desks, ranks } = event.payload;
      let prediction = state.prediction;
      const server = prediction && state.you !== null ? serverProgressOf(desks, state.you) : null;
      if (prediction && server)
        prediction = prediction.reconcile(server, prediction.ackedBy(server));
      return { ...state, desks, ranks, prediction };
    }
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

/** You may type: the race runs, you have a desk, and you have not stopped (finished, asleep...). */
export function selectCanType(state: RaceState): boolean {
  return state.phase === "running" && state.prediction?.state.status === "typing";
}

type ViewEntry = { text: string; jammed: boolean; typedAt: number | null; view: TypedView };
const views = new WeakMap<PlayerState, ViewEntry>();

/**
 * The typing surface's view of your desk (#559 C5): `typedViewFrom` memoised per prediction state, so
 * the strip and the sheet re-render once per keystroke or diverging snapshot, never for a snapshot that
 * agrees with the prediction or one that only moves a rival. The jam and the pop stamp are the
 * prediction's (#220: a refused Block key or a Backspace pops nothing).
 */
export function selectTypedView(state: RaceState): TypedView {
  const p = state.prediction;
  if (!p) return NO_TEXT_VIEW;
  const { text, jammed, typedAt } = p;
  const hit = views.get(p.state);
  if (hit && hit.text === text && hit.jammed === jammed && hit.typedAt === typedAt) return hit.view;
  const view = typedViewFrom(p.state, text, { jammed, typedAt });
  views.set(p.state, { text, jammed, typedAt, view });
  return view;
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
    socket.onSnapshot((payload) => dispatch({ type: "snapshot", payload })),
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
