import {
  applyKeystroke,
  EMPTY_OVERLAY,
  effectiveText,
  initialState,
  type EngineSettings,
  type Keystroke,
  type PlayerState,
  type TextOverlay,
} from "@fifth-copy/engine";

export type { EngineSettings, Keystroke, PlayerState } from "@fifth-copy/engine";

/**
 * The local prediction (#559, ADR 0007, ARCHITECTURE 7.3): the viewer's desk as the engine computes it
 * from every key typed, so a keystroke never waits for the server. The only module of the race feature
 * that touches the engine's reducers: the client applies `applyKeystroke` itself, never a copy of it.
 *
 * A prediction is an immutable value (each method returns a new one, or the same one when nothing
 * changed), so the store keeps it as plain state and React reads it by reference:
 * - `base`: the last state the server confirmed; `unacked`: the keys typed since, in order;
 * - `state`: `base` with every unacked key applied (what the sheet, the strip and the machine show);
 * - `sent`: how many of `unacked` (from the front) went to the server, so only those can be acked.
 */
export type Prediction = {
  /** The text this desk types (the race text with its overlay, `typedText`). */
  readonly text: string;
  readonly settings: EngineSettings;
  readonly base: PlayerState;
  readonly unacked: readonly Keystroke[];
  readonly sent: number;
  readonly state: PlayerState;
  /** Block mode refused the last key the engine took (the machine jams until the right key). */
  readonly jammed: boolean;
  /** Applies a key locally and queues it; the same prediction when the engine refuses it. */
  push(keystroke: Keystroke): Prediction;
  /** `count` more keys left for the server (a batch went out). */
  markSent(count: number): Prediction;
  /**
   * How many of the sent keys the server has applied, read from its state: the largest prefix of them
   * after which the predicted base equals `server`; every sent key when none does (the server refused
   * one, or decided a status: the reconcile then adopts its state).
   */
  ackedBy(server: ServerProgress): number;
  /**
   * Drops the first `ackedCount` keys; when `server` differs from the base they predict, the server's
   * state becomes the base and the remaining keys are applied again on top of it.
   */
  reconcile(server: ServerProgress | PlayerState, ackedCount: number): Prediction;
};

/** What a snapshot says about one desk: `[desk, cursor, correct, errors, status]` without the desk. */
export type ServerProgress = Pick<PlayerState, "cursor" | "correct" | "errors" | "status">;

/** The engine's reducer, injected so the tests can watch it (default: the engine's own). */
export type ApplyKeystroke = (
  state: PlayerState,
  keystroke: Keystroke,
  text: string,
  settings: EngineSettings,
) => PlayerState;

export type PredictionInput = {
  text: string;
  settings: EngineSettings;
  apply?: ApplyKeystroke;
  /** The desk's authoritative state from a `welcome` mid-race; the engine's initial state otherwise. */
  initial?: PlayerState;
};

/** The text a desk types: the race text with the desk's bonus overlay (none when `null`, ADR 0016). */
export function typedText(text: string, overlay: TextOverlay | null): string {
  return effectiveText(text, overlay ?? EMPTY_OVERLAY);
}

/** The server's numbers equal the predicted ones (the fields a snapshot carries). */
function sameProgress(a: ServerProgress, b: ServerProgress): boolean {
  return (
    a.cursor === b.cursor &&
    a.correct === b.correct &&
    a.errors === b.errors &&
    a.status === b.status
  );
}

const isFull = (s: ServerProgress | PlayerState): s is PlayerState => "typed" in s;

/**
 * The server's state as a full engine state: a full one (a `welcome`) as is; a snapshot's four numbers
 * over the predicted base, whose typed record is cut or padded to the server's cursor (a snapshot does
 * not say which characters were struck).
 */
function adopt(from: PlayerState, server: ServerProgress | PlayerState): PlayerState {
  if (isFull(server)) return server;
  const typed =
    from.typed.length >= server.cursor
      ? from.typed.slice(0, server.cursor)
      : [...from.typed, ...Array<null>(server.cursor - from.typed.length).fill(null)];
  const finishedAt =
    server.status === "finished" ? (from.finishedAt ?? from.lastT) : from.finishedAt;
  return { ...from, ...server, typed, finishedAt: server.status === "typing" ? null : finishedAt };
}

const clamp = (n: number, max: number) => Math.max(0, Math.min(max, Math.floor(n)));

export function createPrediction({
  text,
  settings,
  apply = applyKeystroke,
  initial = initialState(),
}: PredictionInput): Prediction {
  const step = (state: PlayerState, keystroke: Keystroke) =>
    apply(state, keystroke, text, settings);
  /** Block mode refused the key: it was counted as an error and the cursor held. */
  const jams = (before: PlayerState, after: PlayerState) =>
    settings.errorMode === "block" && after.errors > before.errors;

  function make(
    base: PlayerState,
    unacked: readonly Keystroke[],
    sent: number,
    state: PlayerState,
    jammed: boolean,
  ): Prediction {
    const self: Prediction = {
      text,
      settings,
      base,
      unacked,
      sent,
      state,
      jammed,
      push(keystroke) {
        const next = step(state, keystroke);
        if (next === state) return self;
        return make(base, [...unacked, keystroke], sent, next, jams(state, next));
      },
      markSent(count) {
        const n = clamp(sent + count, unacked.length);
        return n === sent ? self : make(base, unacked, n, state, jammed);
      },
      ackedBy(server) {
        let s = base;
        let best = sameProgress(s, server) ? 0 : -1;
        for (let i = 0; i < sent; i++) {
          s = step(s, unacked[i]!);
          if (sameProgress(s, server)) best = i + 1;
        }
        return best < 0 ? sent : best;
      },
      reconcile(server, ackedCount) {
        const n = clamp(ackedCount, unacked.length);
        const rest = unacked.slice(n);
        const predicted = unacked.slice(0, n).reduce(step, base);
        const sentLeft = Math.max(0, sent - n);
        if (sameProgress(predicted, server)) {
          // the server agrees: the shown state stands (same object, nothing re-renders)
          return n === 0 ? self : make(predicted, rest, sentLeft, state, jammed);
        }
        const authority = adopt(predicted, server);
        let next = authority;
        let jam = jammed;
        for (const keystroke of rest) {
          const after = step(next, keystroke);
          if (after !== next) jam = jams(next, after);
          next = after;
        }
        return make(authority, rest, sentLeft, next, jam);
      },
    };
    return self;
  }

  return make(initial, [], 0, initial, false);
}
