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
import { expireStamp, pushStamp, STAMP_SHOW_MS, stampFromEvent, type RaceStamp } from "./stamps";

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
  /** The last snapshot's desks `[desk, cursor, correct, errors, statusCode, total]` and live order (#559). */
  desks: Snapshot["desks"];
  ranks: Snapshot["ranks"];
  /**
   * The last key your prediction took (#220): the struck cap and, later, the press (#224), the sound
   * (#243) and the stuck hint (#241) read it. `null` until a key, and again with each new prediction.
   */
  lastKey: LastKey | null;
  /**
   * The overtake stamps (#232, `stamps.ts`): `[0]` is visible, `[1]` pending; empty when none. Reset by
   * every `welcome` and `countdown`.
   */
  stamps: readonly RaceStamp[];
  /** The last stamp id handed out (ids stay unique across resets, so each stamp remounts and slams). */
  stampSeq: number;
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
  /** The host changed the room's settings while waiting (#654): the next countdown predicts with them. */
  | { type: "settings"; payload: RoomEvents["settings"] }
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
  /** A discrete race happening (#232): `overtake` / `passed` of your desk queue a stamp; `at` = device clock. */
  | { type: "event"; payload: RoomEvents["event"]; at: number }
  /** The visible stamp's time is up (scheduled by `watchStampExpiry`). */
  | { type: "stamp-expired"; id: number; at: number }
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
  stamps: [],
  stampSeq: 0,
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

/** Your desk in a snapshot as the numbers the prediction compares (`total` is its exact ack, #645). */
function serverProgressOf(desks: Snapshot["desks"], you: number) {
  const mine = desks.find(([desk]) => desk === you);
  if (!mine) return null;
  const [, cursor, correct, errors, code, total] = mine;
  return { cursor, correct, errors, status: PLAYER_STATUSES[code]!, total };
}

const lost = (state: RaceState, reason: RaceLostReason): RaceState => ({
  ...state,
  phase: "lost",
  lost: reason,
  stamps: [],
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
        stamps: [],
        stampSeq: state.stampSeq,
      };
    }
    case "roster":
      return { ...state, members: byDesk(event.payload.members) };
    case "settings":
      return { ...state, settings: event.payload.settings };
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
        stamps: [],
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
      const { desks, ranks, t } = event.payload;
      let prediction = state.prediction;
      const server = prediction && state.you !== null ? serverProgressOf(desks, state.you) : null;
      if (prediction && server)
        prediction = prediction.reconcile(server, prediction.ackedBy(server, t));
      return { ...state, desks, ranks, prediction };
    }
    case "event": {
      const stamp = stampFromEvent(event.payload, state.you);
      if (!stamp) return state;
      const id = state.stampSeq + 1;
      const stamps = pushStamp(state.stamps, { id, ...stamp, at: event.at });
      if (stamps === state.stamps) return state;
      return { ...state, stamps, stampSeq: stamps.some((s) => s.id === id) ? id : state.stampSeq };
    }
    case "stamp-expired": {
      const stamps = expireStamp(state.stamps, event.id, event.at);
      return stamps === state.stamps ? state : { ...state, stamps };
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

/** The stamp the seat view shows (#232), or `null`: the store's own object, stable between changes. */
export function selectVisibleStamp(state: RaceState): RaceStamp | null {
  return state.stamps[0] ?? null;
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
    socket.onSettings((payload) => dispatch({ type: "settings", payload })),
    socket.onSnapshot((payload) => dispatch({ type: "snapshot", payload })),
    socket.onEvent((payload) => dispatch({ type: "event", payload, at: timer.now() })),
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

/**
 * Expires the visible stamp `STAMP_SHOW_MS` after it shows (#232 C1): on each store change that brings
 * a new visible stamp, one timeout on the injected clock dispatches `stamp-expired`. Returns the stop,
 * which cancels a pending expiry.
 */
export function watchStampExpiry(store: RaceStore, timer: RaceTimer = deviceTimer): Off {
  let shown: number | null = null;
  let pending: unknown = null;
  const cancel = () => {
    if (pending !== null) timer.clearTimeout(pending);
    pending = null;
  };
  const check = () => {
    const visible = selectVisibleStamp(store.getState());
    if ((visible?.id ?? null) === shown) return;
    cancel();
    shown = visible?.id ?? null;
    if (!visible) return;
    const { id } = visible;
    pending = timer.setTimeout(
      () => {
        pending = null;
        store.dispatch({ type: "stamp-expired", id, at: timer.now() });
      },
      Math.max(0, visible.shownAt + STAMP_SHOW_MS - timer.now()),
    );
  };
  const off = store.subscribe(check);
  check();
  return () => {
    off();
    cancel();
  };
}
