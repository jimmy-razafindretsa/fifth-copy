import {
  engineSettingsOf,
  PLAYER_STATUSES,
  type BonusKind,
  type Member,
  type Phase,
  type Snapshot,
  type Welcome,
} from "@fifth-copy/protocol";
import type { LastKey } from "../view/machine-props";
import { raceCardViewFrom, type RaceCardView } from "../view/race-card-view";
import { NO_TEXT_VIEW, typedViewFrom, type TypedView } from "../view/typed-view";
import { bestOffset, clockOffset, remainingTo, type PongSample } from "./clock";
import {
  COOLDOWN_MS,
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

/**
 * Why the page gave up: a handshake refusal (`transport` only reconnects), a token error,
 * `room-lost` (#235 C4): the room went away under a seated page (a voided race after a server restart
 * or a Redis loss, #204, or a reconnect answered `no-room`), or `server-disconnect` (#661): the race
 * server closed the socket (`io server disconnect`: a join refused after the handshake, an abusive
 * client), which socket.io never reconnects.
 */
export type RaceLostReason =
  Exclude<ConnectErrorReason, "transport"> | RaceTokenError | "room-lost" | "server-disconnect";

/** How long the tray shows a refused play (`IMMUNE`, #236 C1). */
export const REFUSAL_SHOW_MS = 1_200;

/**
 * Your desk's side of the bonus economy (#236, ADR 0016), as the server told it: the store keeps it and
 * decides nothing (awarding, cooldown and immunity are #190's, in the engine and on the server). Times
 * are this device's clock. Seeded by every `welcome` from `welcome.bonus` (#768: a reconnect gets back
 * the held card, the cooldown end and the blur end, race ms converted here), reset by every `countdown`.
 */
export type BonusState = {
  /** The card `bonus-earned` dealt you; `null` once `bonus-sent` says you played it. */
  card: BonusKind | null;
  /**
   * When you may play again: set when you play (`COOLDOWN_MS`, the engine's constant, so a second
   * Enter sends nothing while the first is in flight), confirmed by `bonus-sent`, rolled back by a
   * refusal. The client never sends while it runs.
   */
  cooldownUntil: number | null;
  /** A Smoke Break blurs your text until then (`bonus-hit.blurUntil` on this clock); `null` after. */
  blurUntil: number | null;
  /** The server refused your play (`rejected { no-bonus }` while a card is held): the tray says IMMUNE. */
  refused: boolean;
  /** When the refusal arrived (its 1.2 s run from here); `null` with `refused` false. */
  refusedAt: number | null;
  /** A play is in flight: the cooldown before it, to restore on a refusal. */
  pending: { cooldownUntil: number | null } | null;
  /** Plays sent so far on this page (never reset): `sendBonusPlays` emits one `bonus:play` per step. */
  plays: number;
};

const NO_BONUS = {
  card: null,
  cooldownUntil: null,
  blurUntil: null,
  refused: false,
  refusedAt: null,
  pending: null,
} as const satisfies Omit<BonusState, "plays">;

/**
 * How your desk left the race before filing (#233, ARCHITECTURE 7.1): `abandoned` (you confirmed
 * ABANDON, Reassigned) or `asleep` (the server's idle kick, spec 4.5). The server decides it (its
 * `event` or your status in a snapshot or a reload's `welcome`); `dismissed` once you chose KEEP
 * WATCHING (the HUD stays live, without input).
 */
export type ExitKind = "abandoned" | "asleep";
export type RaceExit = { kind: ExitKind; dismissed: boolean };

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
  /**
   * Server time = `Date.now()` + this (#214: `clockOffset` of the last welcome, 0 until one; then the
   * best pong of that welcome's ping round, #643).
   */
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
  /**
   * The server's `ended` (#240, ADR 0006): its reason and final ranking, as sent. `null` until the race
   * ends, and after a reload that finds the room ended (a `welcome` carries no ranking). Reset by every
   * `welcome` and `countdown`.
   */
  ending: RoomEvents["ended"] | null;
  /** This device's clock when `ended` arrived (the `event.at` convention); `null` with `ending`. */
  endedAt: number | null;
  /** Your card, cooldown, blur and refusal (#236); the overlay stays `overlay`. */
  bonus: BonusState;
  /** Your exit (#233), or `null` while you type or filed. Reset by every `welcome` and `countdown`. */
  exit: RaceExit | null;
  /** The server warned your silent desk (`idle-warning`, #233): cleared by your next accepted key. */
  idleWarning: boolean;
  /** The desk the Major's lamp points at (#233 sets it to yours while warned; #267 reads it). */
  lampTarget: number | null;
  /** An abandon intent is in flight (taken, no answer yet): a second confirm sends nothing. */
  abandoning: boolean;
  /** Abandon intents sent so far on this page (never reset): `sendAbandons` emits one per step. */
  abandons: number;
  /**
   * The line was cut (#661 C2): from the drop until the next `welcome`, input is off and no `keys` batch
   * leaves (`createTyping` holds them), so none reaches the server before the reconnect's seat exists.
   */
  keysHeld: boolean;
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
  /** The welcome's ping round refined the clock offset (#643, `bestOffset` of its pongs so far). */
  | { type: "clock"; offset: number }
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
  /**
   * The server ended the race (#240): one case whatever the reason (`all-finished`, `timer`, `void`);
   * the store never switches on it, the view does (#661 adds the lost-room notice for `void`).
   */
  | { type: "ended"; payload: RoomEvents["ended"]; at: number }
  /** The visible stamp's time is up (scheduled by `watchStampExpiry`). */
  | { type: "stamp-expired"; id: number; at: number }
  /**
   * You asked to play your card (#236: Enter in the race input or the tray's button), `at` = device
   * clock. The reducer takes it only while you hold a card, may type and are not cooling.
   */
  | { type: "bonus-play"; at: number }
  /** You confirmed ABANDON (#233): taken once while you may type; `sendAbandons` sends the intent. */
  | { type: "abandon" }
  /** KEEP WATCHING (#233): the exit docket closes, the HUD stays live without input. */
  | { type: "exit-dismissed" }
  /** The server refused a `keys`, `abandon` or `bonus:play` (#236 reads `no-bonus`). */
  | { type: "rejected"; payload: RoomEvents["rejected"]; at: number }
  /** The refusal that arrived at `refusedAt` has shown its 1.2 s (scheduled by `watchRefusalExpiry`). */
  | { type: "refusal-expired"; refusedAt: number }
  /** The blur until `blurUntil` is over (scheduled by `watchBlurExpiry`). */
  | { type: "blur-expired"; blurUntil: number }
  | { type: "connect-error"; reason: ConnectErrorReason }
  | { type: "reconnecting" }
  | { type: "reconnected" }
  /** The line dropped (`transport close`, `ping timeout`...: #661 C2), before socket.io's first retry. */
  | { type: "disconnected" }
  /** The server closed the socket (`io server disconnect`, #661 C1): final. */
  | { type: "server-disconnect" }
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
  ending: null,
  endedAt: null,
  bonus: { ...NO_BONUS, plays: 0 },
  exit: null,
  idleWarning: false,
  lampTarget: null,
  abandoning: false,
  abandons: 0,
  keysHeld: false,
};

/** No exit, no warning, no lamp, nothing in flight: a (re)connect or a new race (#233). */
const NO_EXIT = {
  exit: null,
  idleWarning: false,
  lampTarget: null,
  abandoning: false,
} as const satisfies Partial<RaceState>;

/**
 * The exit your desk's status implies (#233): `abandoned` and `asleep` are exits, any other status
 * none. The server's status wins over a lost event: a snapshot or a reload's `welcome` brings it.
 */
function exitFromStatus(prediction: Prediction | null): ExitKind | null {
  const status = prediction?.state.status;
  return status === "abandoned" || status === "asleep" ? status : null;
}

/** `state` with the exit its prediction's status implies, unless an exit is already known. */
function withStatusExit(state: RaceState): RaceState {
  if (state.exit) return state;
  const kind = exitFromStatus(state.prediction);
  return kind ? { ...state, ...NO_EXIT, exit: { kind, dismissed: false } } : state;
}

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

/**
 * Your prediction after a welcome (#235 C1, ADR 0007): the welcome of a reconnect to the same race and
 * desk reconciles the one you have onto the server's state of your desk (every key sent before the cut
 * was applied or dropped by then; a key not yet sent is typed again on top), so a sheet the server
 * agrees with keeps its very state; any other welcome starts over from the server's state.
 */
function predictionAfterWelcome(state: RaceState, w: Welcome): Prediction | null {
  const { prediction } = state;
  const sameDesk =
    prediction !== null &&
    w.race !== null &&
    w.state !== null &&
    w.you !== null &&
    w.you === state.you &&
    w.race.raceId === state.race?.raceId;
  if (!sameDesk || !w.race || !w.state)
    return predictionOf(w.race, w.you, w.settings, w.overlay, w.state);
  return prediction.withText(typedText(w.race.text, w.overlay)).reconcile(w.state, prediction.sent);
}

/**
 * Your bonus after a welcome (#768): the server's `welcome.bonus` of your desk, its race ms (since
 * `t0`, server clock) moved to this device's clock with the welcome's `offset`, like `bonus-hit`. No
 * play is in flight and no refusal shows after a (re)connect; the play counter never goes back.
 */
function bonusFromWelcome(w: Welcome, offset: number, plays: number): BonusState {
  const { bonus, race } = w;
  if (!bonus || !race) return { ...NO_BONUS, plays };
  const device = (ms: number | null) => (ms === null ? null : race.t0 + ms - offset);
  return {
    ...NO_BONUS,
    card: bonus.card,
    cooldownUntil: device(bonus.cooldownUntil),
    blurUntil: device(bonus.blurUntil),
    plays,
  };
}

export function reduceRace(state: RaceState, event: RaceEvent): RaceState {
  // Lost is terminal: the room refused this viewer and nothing later revives the page (the lost line
  // links back to the waiting room).
  if (state.phase === "lost") return state;
  switch (event.type) {
    case "welcome": {
      const w = event.payload;
      const prediction = predictionAfterWelcome(state, w);
      const offset =
        event.receivedAt === undefined
          ? state.clockOffset
          : clockOffset(w.serverNow, event.receivedAt);
      const next: RaceState = {
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
        clockOffset: offset,
        // a connect starts from the server's state of your desk; a reconnect reconciles onto it (#235)
        prediction,
        desks: state.desks,
        ranks: state.ranks,
        // the struck cap stays when the reconcile kept your sheet as it was
        lastKey:
          prediction !== null && prediction.state === state.prediction?.state
            ? state.lastKey
            : null,
        stamps: [],
        stampSeq: state.stampSeq,
        ending: null,
        endedAt: null,
        bonus: bonusFromWelcome(w, offset, state.bonus.plays),
        ...NO_EXIT,
        abandons: state.abandons,
        // the reconnect's seat exists: held keys may leave (#661 C2)
        keysHeld: false,
      };
      // a reload after your exit: the server's status brings the docket back
      return withStatusExit(next);
    }
    case "clock":
      return event.offset === state.clockOffset ? state : { ...state, clockOffset: event.offset };
    case "roster":
      return { ...state, members: byDesk(event.payload.members) };
    case "settings":
      return { ...state, settings: event.payload.settings };
    case "countdown":
      // a new race: no overlay, no card yet (the server deals them once it runs)
      return {
        ...state,
        phase: "countdown",
        race: event.payload.race,
        room: state.room && { ...state.room, phase: "countdown" },
        overlay: null,
        prediction: predictionOf(event.payload.race, state.you, state.settings, null, null),
        desks: [],
        ranks: [],
        lastKey: null,
        stamps: [],
        ending: null,
        endedAt: null,
        bonus: { ...NO_BONUS, plays: state.bonus.plays },
        ...NO_EXIT,
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
      // ... and after your exit (#233: the server decided, the prediction may not know yet)
      if (state.phase !== "running" || !state.prediction || state.exit) return state;
      const prediction = state.prediction.push(event.keystroke);
      if (prediction === state.prediction) return state;
      // the engine's verdict on the key, as the prediction read it (#220): no comparison here
      const { key, t } = event.keystroke;
      // an accepted key ends the idle warning (#233): the Major looks away
      return {
        ...state,
        prediction,
        lastKey: { key, t, wrong: prediction.wrong },
        idleWarning: false,
        lampTarget: null,
      };
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
      return withStatusExit({ ...state, desks, ranks, prediction });
    }
    case "ended":
      // a voided race is the lost room (#235 C4, #204): nothing to rank, the way back to the lobby
      if (event.payload.reason === "void") return lost(state, "room-lost");
      // otherwise the phase, the server's ranking as sent and when it arrived (#240); the visible stamp
      // keeps its 1.4 s (a finish stamp may still be on screen)
      return {
        ...state,
        phase: "ended",
        room: state.room && { ...state.room, phase: "ended" },
        ending: event.payload,
        endedAt: event.at,
        idleWarning: false,
        lampTarget: null,
      };
    case "event": {
      const bonus = reduceBonusEvent(state, event.payload, event.at);
      if (bonus) return bonus;
      const exit = reduceExitEvent(state, event.payload);
      if (exit) return exit;
      const stamp = stampFromEvent(event.payload, state.you, state.prediction?.state.errors ?? 0);
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
    case "bonus-play": {
      if (!mayPlayAt(state, event.at)) return state;
      const { bonus } = state;
      return {
        ...state,
        bonus: {
          ...bonus,
          cooldownUntil: event.at + COOLDOWN_MS,
          pending: { cooldownUntil: bonus.cooldownUntil },
          refused: false,
          refusedAt: null,
          plays: bonus.plays + 1,
        },
      };
    }
    case "abandon":
      if (!selectCanType(state) || state.abandoning) return state;
      return { ...state, abandoning: true, abandons: state.abandons + 1 };
    case "exit-dismissed":
      if (!state.exit || state.exit.dismissed) return state;
      return { ...state, exit: { ...state.exit, dismissed: true } };
    case "rejected": {
      // an abandon refused (`not-running`: the race ended or you stopped first) may be confirmed again
      if (event.payload.reason === "not-running" && state.abandoning)
        return { ...state, abandoning: false };
      // every refusal of a play is `no-bonus` on the wire (#190); the client never sends while cooling,
      // so one while a card is held means the target is immune (or there is none)
      const { bonus } = state;
      if (event.payload.reason !== "no-bonus" || (!bonus.pending && !bonus.card)) return state;
      return {
        ...state,
        bonus: {
          ...bonus,
          cooldownUntil: bonus.pending ? bonus.pending.cooldownUntil : bonus.cooldownUntil,
          pending: null,
          refused: true,
          refusedAt: event.at,
        },
      };
    }
    case "refusal-expired": {
      const { bonus } = state;
      if (!bonus.refused || bonus.refusedAt !== event.refusedAt) return state;
      return { ...state, bonus: { ...bonus, refused: false, refusedAt: null } };
    }
    case "blur-expired": {
      const { bonus } = state;
      if (bonus.blurUntil !== event.blurUntil) return state;
      return { ...state, bonus: { ...bonus, blurUntil: null } };
    }
    case "connect-error":
      // `transport` (network, timeout): socket.io keeps retrying; any refusal is final
      if (event.reason === "transport") return { ...state, phase: "reconnecting", keysHeld: true };
      // a reconnect after a welcome that finds no room: the room was lost under you (#235 C4)
      if (event.reason === "no-room" && state.room !== null) return lost(state, "room-lost");
      return lost(state, event.reason);
    case "reconnecting":
    case "disconnected":
      return { ...state, phase: "reconnecting", keysHeld: true };
    case "reconnected":
      // the fresh `welcome` that follows a reconnect sets the real phase and lets the keys go
      return { ...state, phase: state.room?.phase ?? "connecting" };
    case "server-disconnect":
      return lost(state, "server-disconnect");
    case "token-error":
      return lost(state, event.error);
  }
}

/**
 * The bonus events of your desk (#236), or `null` for any other event (the stamps read those):
 * `bonus-earned` deals you the card, `bonus-sent` from you confirms the play (the card is gone, the
 * cooldown runs from its arrival), `bonus-hit` on you brings the overlay (the prediction types the new
 * effective text, `typedText`) and the Smoke Break's end on this device's clock.
 */
function reduceBonusEvent(
  state: RaceState,
  payload: RoomEvents["event"],
  at: number,
): RaceState | null {
  const { bonus, you } = state;
  switch (payload.kind) {
    case "bonus-earned":
      if (payload.desk !== you || bonus.card === payload.bonus) return state;
      return { ...state, bonus: { ...bonus, card: payload.bonus } };
    case "bonus-sent":
      if (payload.from !== you) return state;
      return {
        ...state,
        bonus: { ...bonus, card: null, cooldownUntil: at + COOLDOWN_MS, pending: null },
      };
    case "bonus-hit": {
      if (payload.desk !== you || !state.race) return state;
      const overlay = payload.overlay ?? state.overlay;
      const prediction = state.prediction?.withText(typedText(state.race.text, overlay)) ?? null;
      // race ms -> server clock (`t0`) -> this device's clock
      const blurUntil =
        payload.blurUntil === null
          ? bonus.blurUntil
          : state.race.t0 + payload.blurUntil - state.clockOffset;
      return { ...state, overlay, prediction, bonus: { ...bonus, blurUntil } };
    }
    default:
      return null;
  }
}

/**
 * The exit and idle events of your desk (#233, ADR 0006: the server decides both), or `null` for any
 * other event: `abandoned` and `asleep` (the idle kick, C1's `kicked`) set your exit, `idle-warning`
 * turns the warning on and points the Major's lamp at you. Another desk's changes nothing here (the
 * race card reads its status from the snapshots).
 */
function reduceExitEvent(state: RaceState, payload: RoomEvents["event"]): RaceState | null {
  switch (payload.kind) {
    case "abandoned":
    case "asleep":
      if (payload.desk !== state.you || state.exit) return state;
      return { ...state, ...NO_EXIT, exit: { kind: payload.kind, dismissed: false } };
    case "idle-warning":
      if (payload.desk !== state.you || !selectCanType(state)) return state;
      if (state.idleWarning && state.lampTarget === state.you) return state;
      return { ...state, idleWarning: true, lampTarget: state.you };
    default:
      return null;
  }
}

/**
 * A play at `at` (device clock) may go out: the race runs, you type, bonuses are on, you hold a card,
 * no play is in flight and the cooldown is over. The server decides again (#190); this only keeps the
 * client from sending what it knows is refused.
 */
function mayPlayAt(state: RaceState, at: number): boolean {
  const { bonus } = state;
  return (
    selectCanType(state) &&
    state.settings?.bonuses !== false &&
    bonus.card !== null &&
    bonus.pending === null &&
    (bonus.cooldownUntil === null || at >= bonus.cooldownUntil)
  );
}

/**
 * You may type: the race runs, you have a desk, you have not stopped (finished, asleep...), and no cut
 * line waits for its reconnect's welcome (#661 C2, bible 14.2: input is off until it).
 */
export function selectCanType(state: RaceState): boolean {
  return (
    state.phase === "running" &&
    state.prediction?.state.status === "typing" &&
    state.exit === null &&
    !state.keysHeld
  );
}

/** Abandon's state from the store (#233 C2): `idle` while you may type and none is in flight. */
export function selectAbandonState(state: RaceState): "idle" | "disabled" {
  return selectCanType(state) && !state.abandoning ? "idle" : "disabled";
}

/**
 * The exit docket the seat view shows (#233 C3, C4): your exit while the race runs and until KEEP
 * WATCHING; `null` otherwise (RACE OVER yields to the finished view).
 */
export function selectExit(state: RaceState): ExitKind | null {
  const { exit } = state;
  return state.phase === "running" && exit && !exit.dismissed ? exit.kind : null;
}

/** What the tray and the typing surface show of your bonus (#236 C1): stable between changes. */
export type BonusView = {
  card: BonusKind | null;
  cooldownUntil: number | null;
  overlay: RaceState["overlay"];
  blurUntil: number | null;
  refused: boolean;
};

const bonusViews = new WeakMap<BonusState, { overlay: RaceState["overlay"]; view: BonusView }>();

/** The viewer's bonus as `{ card, cooldownUntil, overlay, blurUntil, refused }`, memoised per change. */
export function selectBonus(state: RaceState): BonusView {
  const { bonus, overlay } = state;
  const hit = bonusViews.get(bonus);
  if (hit && hit.overlay === overlay) return hit.view;
  const { card, cooldownUntil, blurUntil, refused } = bonus;
  const view = { card, cooldownUntil, overlay, blurUntil, refused };
  bonusViews.set(bonus, { overlay, view });
  return view;
}

type ViewEntry = {
  text: string;
  jammed: boolean;
  typedAt: number | null;
  blurUntil: number | null;
  view: TypedView;
};
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
  // the blur watcher clears `blurUntil` when it passes: no clock here (#236)
  const { blurUntil } = state.bonus;
  const hit = views.get(p.state);
  if (
    hit &&
    hit.text === text &&
    hit.jammed === jammed &&
    hit.typedAt === typedAt &&
    hit.blurUntil === blurUntil
  ) {
    return hit.view;
  }
  const view = typedViewFrom(p.state, text, { jammed, typedAt, blurUntil });
  views.set(p.state, { text, jammed, typedAt, blurUntil, view });
  return view;
}

/**
 * The race card's view (#564 C3): members joined with the last snapshot, the lanes selected, memoised
 * per snapshot (`raceCardViewFrom`), so a keystroke or a `sent` re-renders no card.
 */
export function selectRaceCardView(state: RaceState): RaceCardView {
  return raceCardViewFrom(state);
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
 * The ping round after each `welcome` (#643): this many pings, this far apart. 600 ms keeps any 1 s
 * window at 2 pings, inside the race server's `ping` budget (ADR 0020: 2 a second per identity, and 3
 * refusals disconnect); the round (2.4 s) ends inside the 3 s countdown.
 */
export const PING_ROUND_COUNT = 5;
export const PING_ROUND_INTERVAL_MS = 600;

/**
 * Subscribes the room socket's events and turns them into race events; returns the unbind, which offs
 * every listener bound here (and only those) and cancels a pending GO. Every `welcome` stores its resume
 * key for this lobby, so the next page (a reload, the seat view after the lobby) can reclaim the desk,
 * and sets the clock offset. GO is scheduled at `race.t0` on the corrected clock from a `countdown`, or
 * from a `welcome` that finds the room counting down (the seat view connects after the broadcast, #214).
 * Each `welcome` also starts a ping round (#643): `PING_ROUND_COUNT` pings `PING_ROUND_INTERVAL_MS`
 * apart on the injected timer (never closer, across rounds too); each pong of the round that improves its best round trip sets the
 * offset (`bestOffset`) and moves a pending GO onto it. The unbind cancels the pings still to send.
 */
export function bindRaceSocket(
  socket: RoomSocket,
  dispatch: (event: RaceEvent) => void,
  { lobbyId, timer = deviceTimer }: BindRaceSocketOptions = {},
): Off {
  let offset = 0;
  let pendingGo: unknown = null;
  let goAt: number | null = null;
  const cancelGo = () => {
    if (pendingGo !== null) timer.clearTimeout(pendingGo);
    pendingGo = null;
    goAt = null;
  };
  const scheduleGo = (t0: number) => {
    cancelGo();
    goAt = t0;
    pendingGo = timer.setTimeout(
      () => {
        pendingGo = null;
        goAt = null;
        dispatch({ type: "go" });
      },
      remainingTo(t0, timer.now() + offset),
    );
  };

  // the current welcome's ping round: the send times still awaited, its pongs, its best offset so far
  let pendingPing: unknown = null;
  let awaited = new Set<number>();
  let samples: PongSample[] = [];
  let roundOffset: number | null = null;
  let lastPingAt: number | null = null;
  const cancelPings = () => {
    if (pendingPing !== null) timer.clearTimeout(pendingPing);
    pendingPing = null;
  };
  const startPingRound = () => {
    cancelPings();
    awaited = new Set();
    samples = [];
    roundOffset = null;
    let sentCount = 0;
    const ping = () => {
      pendingPing = null;
      const sent = timer.now();
      lastPingAt = sent;
      awaited.add(sent);
      socket.sendPing(sent);
      if (++sentCount < PING_ROUND_COUNT)
        pendingPing = timer.setTimeout(ping, PING_ROUND_INTERVAL_MS);
    };
    // a welcome soon after a ping (a reconnect mid-round) keeps the spacing across rounds too
    const wait = lastPingAt === null ? 0 : lastPingAt + PING_ROUND_INTERVAL_MS - timer.now();
    if (wait > 0) pendingPing = timer.setTimeout(ping, wait);
    else ping();
  };
  const onPong = ({ sent, serverNow }: RoomEvents["pong"]) => {
    if (!awaited.has(sent)) return; // a stale round's pong, or one this binder never asked for
    awaited.delete(sent);
    samples.push({ sent, serverNow, receivedAt: timer.now() });
    const refined = bestOffset(samples);
    if (refined === null || Math.round(refined) === roundOffset) return;
    // whole milliseconds, like the welcome's offset: the countdown and the timers step on whole ms
    roundOffset = offset = Math.round(refined);
    dispatch({ type: "clock", offset });
    if (goAt !== null) scheduleGo(goAt);
  };

  const offs: Off[] = [
    socket.onWelcome((payload) => {
      const receivedAt = timer.now();
      offset = clockOffset(payload.serverNow, receivedAt);
      if (lobbyId && payload.resumeKey) storeResumeKey(lobbyId, payload.resumeKey);
      dispatch({ type: "welcome", payload, receivedAt });
      if (payload.room.phase === "countdown" && payload.race) scheduleGo(payload.race.t0);
      else cancelGo();
      startPingRound();
    }),
    socket.onPong(onPong),
    socket.onRoster((payload) => dispatch({ type: "roster", payload })),
    socket.onSettings((payload) => dispatch({ type: "settings", payload })),
    socket.onSnapshot((payload) => dispatch({ type: "snapshot", payload })),
    socket.onEvent((payload) => dispatch({ type: "event", payload, at: timer.now() })),
    socket.onEnded((payload) => dispatch({ type: "ended", payload, at: timer.now() })),
    socket.onRejected((payload) => dispatch({ type: "rejected", payload, at: timer.now() })),
    socket.onCountdown((payload) => {
      dispatch({ type: "countdown", payload });
      scheduleGo(payload.race.t0);
    }),
    socket.onConnectError((reason) => dispatch({ type: "connect-error", reason })),
    socket.onTransportDisconnect(() => dispatch({ type: "disconnected" })),
    socket.onReconnecting(() => dispatch({ type: "reconnecting" })),
    socket.onReconnected(() => dispatch({ type: "reconnected" })),
    socket.onServerDisconnect(() => dispatch({ type: "server-disconnect" })),
  ];
  return () => {
    cancelGo();
    cancelPings();
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

/**
 * One timeout on the injected clock for a deadline the store holds (`pick`): each store change that
 * brings a new deadline re-schedules it, and `fire` dispatches its expiry at that time. Returns the stop.
 */
function watchDeadline(
  store: RaceStore,
  timer: RaceTimer,
  pick: (state: RaceState) => number | null,
  fire: (deadline: number) => RaceEvent,
  delay: (deadline: number) => number,
): Off {
  let watched: number | null = null;
  let pending: unknown = null;
  const cancel = () => {
    if (pending !== null) timer.clearTimeout(pending);
    pending = null;
  };
  const check = () => {
    const deadline = pick(store.getState());
    if (deadline === watched) return;
    cancel();
    watched = deadline;
    if (deadline === null) return;
    pending = timer.setTimeout(
      () => {
        pending = null;
        store.dispatch(fire(deadline));
      },
      Math.max(0, delay(deadline) - timer.now()),
    );
  };
  const off = store.subscribe(check);
  check();
  return () => {
    off();
    cancel();
  };
}

/** Clears the tray's `IMMUNE` `REFUSAL_SHOW_MS` after the refusal arrived (#236 C1). */
export function watchRefusalExpiry(store: RaceStore, timer: RaceTimer = deviceTimer): Off {
  return watchDeadline(
    store,
    timer,
    (s) => (s.bonus.refused ? s.bonus.refusedAt : null),
    (refusedAt) => ({ type: "refusal-expired", refusedAt }),
    (refusedAt) => refusedAt + REFUSAL_SHOW_MS,
  );
}

/** Lifts a Smoke Break's blur at its `blurUntil` (#236 C2), so no selector reads the clock. */
export function watchBlurExpiry(store: RaceStore, timer: RaceTimer = deviceTimer): Off {
  return watchDeadline(
    store,
    timer,
    (s) => s.bonus.blurUntil,
    (blurUntil) => ({ type: "blur-expired", blurUntil }),
    (blurUntil) => blurUntil,
  );
}

/** The one send a bonus play needs (`RoomSocket.sendBonusPlay`). */
export type BonusPlaySink = { sendBonusPlay(): void };

/**
 * Sends one `bonus:play` per play the store took (#236 C1): the reducer gates a `bonus-play` (a card,
 * not cooling, no play in flight), so an Enter or a click it refused sends nothing. Returns the stop.
 */
export function sendBonusPlays(store: RaceStore, socket: BonusPlaySink): Off {
  let sent = store.getState().bonus.plays;
  return store.subscribe(() => {
    const { plays } = store.getState().bonus;
    for (; sent < plays; sent++) socket.sendBonusPlay();
  });
}

/** The one send an abandon needs (`RoomSocket.sendAbandon`). */
export type AbandonSink = { sendAbandon(): void };

/**
 * Sends one `abandon` per intent the store took (#233 C1): the reducer takes a confirm once, while you
 * may type, so a double press or a press after the exit sends nothing. Returns the stop.
 */
export function sendAbandons(store: RaceStore, socket: AbandonSink): Off {
  let sent = store.getState().abandons;
  return store.subscribe(() => {
    const { abandons } = store.getState();
    for (; sent < abandons; sent++) socket.sendAbandon();
  });
}
