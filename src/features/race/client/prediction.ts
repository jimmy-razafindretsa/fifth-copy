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
import { MAX_LAG_MS } from "@fifth-copy/protocol";

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
  /** The engine counted the last key it took as an error (its `errors` grew; never a Backspace). */
  readonly wrong: boolean;
  /** Block mode refused the last key the engine took (the machine jams until the right key). */
  readonly jammed: boolean;
  /**
   * `t` of the key that typed the char before the cursor (it keys that char's pop); `null` when unknown:
   * before the first key, after a Backspace, from a server state. A key that types nothing keeps it.
   */
  readonly typedAt: number | null;
  /** Applies a key locally and queues it; the same prediction when the engine refuses it. */
  push(keystroke: Keystroke): Prediction;
  /** `count` more keys left for the server (a batch went out). */
  markSent(count: number): Prediction;
  /**
   * How many of the sent keys the server has applied (#645), from a snapshot taken at `at` (ms since
   * GO): exactly the growth of its `total` over the base's; every sent key when the server's desk
   * stopped typing (the reconcile then adopts its state); and at least every sent key older than
   * `MAX_LAG_MS` at `at`, so a key the server dropped (budget, trace cap) never stays pending.
   */
  ackedBy(server: ServerProgress, at: number): number;
  /**
   * Drops the first `ackedCount` keys; when `server` differs from the base they predict, the server's
   * state becomes the base and the remaining keys are applied again on top of it.
   */
  reconcile(server: ServerProgress | PlayerState, ackedCount: number): Prediction;
};

/**
 * What a snapshot says about one desk: `[desk, cursor, correct, errors, status, total]` without the
 * desk (`total`: the engine's accepted presses, the exact ack, #645).
 */
export type ServerProgress = Pick<
  PlayerState,
  "cursor" | "correct" | "errors" | "status" | "total"
>;

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
    a.status === b.status &&
    a.total === b.total
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
  // only a finished desk has a finish time (the engine stamps it; the snapshot has none)
  const finishedAt = server.status === "finished" ? (from.finishedAt ?? from.lastT) : null;
  return { ...from, ...server, typed, finishedAt };
}

const clamp = (n: number, max: number) => Math.max(0, Math.min(max, Math.floor(n)));

/** What the engine's numbers say about the last key it took (#220): struck, and the pop stamp. */
type Mark = { readonly wrong: boolean; readonly typedAt: number | null };
const NO_MARK: Mark = { wrong: false, typedAt: null };

/**
 * The mark of a key the engine took (`before` -> `after`): wrong when it counted an error; the pop stamp
 * moves to the key when the cursor advanced, clears when it went back, and stays when it held.
 */
function markOf(before: PlayerState, after: PlayerState, t: number, prev: Mark): Mark {
  const typedAt =
    after.cursor > before.cursor ? t : after.cursor < before.cursor ? null : prev.typedAt;
  return { wrong: after.errors > before.errors, typedAt };
}

export function createPrediction({
  text,
  settings,
  apply = applyKeystroke,
  initial = initialState(),
}: PredictionInput): Prediction {
  const step = (state: PlayerState, keystroke: Keystroke) =>
    apply(state, keystroke, text, settings);

  function make(
    base: PlayerState,
    unacked: readonly Keystroke[],
    sent: number,
    state: PlayerState,
    mark: Mark,
  ): Prediction {
    const self: Prediction = {
      text,
      settings,
      base,
      unacked,
      sent,
      state,
      wrong: mark.wrong,
      // Block mode refused the key: it was counted as an error and the cursor held
      jammed: settings.errorMode === "block" && mark.wrong,
      typedAt: mark.typedAt,
      push(keystroke) {
        const next = step(state, keystroke);
        if (next === state) return self;
        return make(
          base,
          [...unacked, keystroke],
          sent,
          next,
          markOf(state, next, keystroke.t, mark),
        );
      },
      markSent(count) {
        const n = clamp(sent + count, unacked.length);
        return n === sent ? self : make(base, unacked, n, state, mark);
      },
      ackedBy(server, at) {
        if (server.status !== "typing") return sent;
        // every key the engine took raised `total` by one on both sides, in the same order
        const exact = clamp(server.total - base.total, sent);
        // a key this old would have been applied by now: the server dropped it
        let stale = 0;
        while (stale < sent && unacked[stale]!.t <= at - MAX_LAG_MS) stale++;
        return Math.max(exact, stale);
      },
      reconcile(server, ackedCount) {
        const n = clamp(ackedCount, unacked.length);
        const rest = unacked.slice(n);
        const predicted = unacked.slice(0, n).reduce(step, base);
        const sentLeft = Math.max(0, sent - n);
        if (sameProgress(predicted, server)) {
          // the server agrees: the shown state stands (same object, nothing re-renders)
          return n === 0 ? self : make(predicted, rest, sentLeft, state, mark);
        }
        // the server's state stands: no char of it was just typed, so nothing pops for it
        const authority = adopt(predicted, server);
        let next = authority;
        let m: Mark = { wrong: mark.wrong, typedAt: null };
        for (const keystroke of rest) {
          const after = step(next, keystroke);
          if (after !== next) m = markOf(next, after, keystroke.t, m);
          next = after;
        }
        return make(authority, rest, sentLeft, next, m);
      },
    };
    return self;
  }

  return make(initial, [], 0, initial, NO_MARK);
}
