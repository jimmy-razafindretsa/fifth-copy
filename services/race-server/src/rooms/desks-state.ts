import type { Redis } from "ioredis";
import {
  charsOf,
  initialState,
  normalizeTypeable,
  type EngineSettings,
  type Keystroke,
  type PlayerState,
} from "@fifth-copy/engine";
import { engineSettingsOf, type RaceInfo, type RaceSettings } from "@fifth-copy/protocol";
import { desksKey, ROOM_TTL_S, traceKey } from "./keys";
import type { RaceDesk } from "./registry";

/**
 * One desk's authoritative state (#173): the engine's `PlayerState` plus what the server learns
 * about the stream. `lastKeyAt`: server ms epoch of the last accepted batch (GO before any, idle
 * #183). `timingAnomalies`: batches with a clamped, non-monotonic or stale `t` (read by #195).
 * `droppedKeys`: keys refused by the history or rate bounds of `ingest` (read by #195).
 * `trace`: every keystroke handed to the engine, with the `t` it was applied at (persisted by #189);
 * appended in place, so the engine state replays from it. Bounded by `traceCapOf(textLength)`.
 */
export type DeskState = PlayerState & {
  readonly lastKeyAt: number;
  readonly timingAnomalies: number;
  readonly droppedKeys: number;
  readonly trace: Keystroke[];
};

/**
 * The in-process half of a running room (ADR 0008 in-process cache): everything the hot path needs
 * without a Redis read. `running` from GO; `ended` from `endRace` on (keys then get `not-running`).
 */
export type RoomRuntime = {
  readonly lobbyId: string;
  readonly raceId: string;
  /** GO instant, server ms epoch. */
  readonly t0: number;
  /** `normalizeTypeable`d once here, as `applyKeystroke` requires. */
  readonly text: string;
  readonly textLength: number;
  readonly engine: EngineSettings;
  /** Desks captured at start, by desk ascending. */
  readonly desks: readonly RaceDesk[];
  phase: "running" | "ended";
  readonly states: Map<number, DeskState>;
  /** Desks changed since the last flush. */
  readonly dirty: Set<number>;
  /** Per-desk keystroke budget of `ingest` (in-process only, never mirrored). */
  readonly budgets: Map<number, { tokens: number; at: number }>;
};

/** The trace bound lives in the engine, shared with the web's persistence (#189). */
export { TRACE_ALLOWANCE, TRACE_KEYS_PER_CHAR, traceCapOf } from "@fifth-copy/engine";

export type DesksState = {
  /** Creates the runtime at GO: every desk at `initialState()`, all dirty. Replaces a previous race's. */
  open(
    lobbyId: string,
    init: { race: RaceInfo; settings: RaceSettings; desks: RaceDesk[] },
  ): RoomRuntime;
  get(lobbyId: string): RoomRuntime | undefined;
  /**
   * Replaces a desk's state and marks it dirty. The seam for presence and idle (#178, #183: status
   * `line-cut`, `expired`, `asleep`) and for tests; a desk outside the race is ignored.
   */
  set(lobbyId: string, desk: number, state: DeskState): void;
  /** Current states by desk; empty for an unknown or released room. */
  states(lobbyId: string): ReadonlyMap<number, DeskState>;
  /**
   * Writes the dirty desks in one MULTI, every written key with the room TTL, then clears them: the
   * counters to `room:<id>:desks`, the keystrokes appended since the last flush to
   * `room:<id>:trace:<desk>` (#592). No Redis call when nothing changed. On failure the desks stay
   * dirty for the next tick, which rewrites their lists whole.
   */
  flush(lobbyId: string): Promise<void>;
  /** The race ended: phase `ended`, states kept for the end-of-race readers (#189). */
  end(lobbyId: string): void;
  /** Frees the states and traces (after `onRaceEnded`); keys still get `not-running`. */
  release(lobbyId: string): void;
  /** The room closed: forgets it. */
  close(lobbyId: string): void;
};

export function deskStateOf(
  state: PlayerState,
  extra: Omit<DeskState, keyof PlayerState>,
): DeskState {
  return { ...state, ...extra };
}

/** The engine part of a desk state, as `welcome.state` carries it (a fresh `typed` array). */
export function playerStateOf({
  cursor,
  correct,
  errors,
  total,
  typed,
  status,
  lastT,
  finishedAt,
}: DeskState): PlayerState & { typed: (string | null)[] } {
  return { cursor, correct, errors, total, typed: [...typed], status, lastT, finishedAt };
}

/**
 * What the mirror already holds of a desk's trace: `flushed` entries of this very array. Traces are
 * appended in place, so the same reference with `length >= flushed` means "push the rest"; any other
 * array (a `set()` with a new trace, a new race) means "rewrite the list" (#592).
 */
type MirroredTrace = { trace: readonly Keystroke[]; flushed: number };

/** The hash field of a desk: its counters and status, never the trace or the `typed` row (#592). */
function serialise(state: DeskState): string {
  return JSON.stringify(state, (key, value: unknown) =>
    key === "trace" || key === "typed" ? undefined : value,
  );
}

export function createDesksState({ redis }: { redis: Redis }): DesksState {
  const rooms = new Map<string, RoomRuntime>();
  const mirrored = new Map<string, Map<number, MirroredTrace>>();
  /** Trace lists of a previous race's desks, deleted by the next successful flush. */
  const staleTraces = new Map<string, Set<number>>();

  return {
    open(lobbyId, { race, settings, desks }) {
      const text = normalizeTypeable(race.text);
      const runtime: RoomRuntime = {
        lobbyId,
        raceId: race.raceId,
        t0: race.t0,
        text,
        textLength: charsOf(text).length,
        engine: engineSettingsOf(settings),
        desks: [...desks].sort((a, b) => a.desk - b.desk),
        phase: "running",
        states: new Map(
          desks.map(({ desk }) => [
            desk,
            deskStateOf(initialState(), {
              lastKeyAt: race.t0,
              timingAnomalies: 0,
              droppedKeys: 0,
              trace: [],
            }),
          ]),
        ),
        dirty: new Set(desks.map(({ desk }) => desk)),
        budgets: new Map(),
      };
      // This race's desks have no mirrored trace yet, so their first write empties their list; the
      // previous race's other desks are emptied explicitly ("Race again" must not append onto it).
      const stale = staleTraces.get(lobbyId) ?? new Set<number>();
      for (const { desk } of rooms.get(lobbyId)?.desks ?? []) stale.add(desk);
      for (const { desk } of desks) stale.delete(desk);
      if (stale.size) staleTraces.set(lobbyId, stale);
      else staleTraces.delete(lobbyId);
      rooms.set(lobbyId, runtime);
      mirrored.set(lobbyId, new Map());
      return runtime;
    },

    get: (lobbyId) => rooms.get(lobbyId),

    set(lobbyId, desk, state) {
      const runtime = rooms.get(lobbyId);
      if (!runtime?.states.has(desk)) return;
      runtime.states.set(desk, state);
      runtime.dirty.add(desk);
    },

    states: (lobbyId) => rooms.get(lobbyId)?.states ?? new Map(),

    async flush(lobbyId) {
      const runtime = rooms.get(lobbyId);
      if (!runtime || runtime.dirty.size === 0) return;
      const desks = [...runtime.dirty];
      runtime.dirty.clear();
      // Built now, so a key applied while EXEC is in flight lands in the next flush.
      const cache = mirrored.get(lobbyId) ?? new Map<number, MirroredTrace>();
      const fields: Record<string, string> = {};
      const lists: { key: string; reset: boolean; entries: string[] }[] = [];
      for (const desk of desks) {
        const state = runtime.states.get(desk);
        if (!state) continue;
        fields[desk] = serialise(state);
        const { trace } = state;
        const seen = cache.get(desk);
        const reset = !(seen?.trace === trace && seen.flushed <= trace.length);
        const from = reset ? 0 : seen!.flushed;
        if (reset || trace.length > from) {
          const entries = trace.slice(from).map((k) => JSON.stringify(k));
          lists.push({ key: traceKey(lobbyId, desk), reset, entries });
        }
        cache.set(desk, { trace, flushed: trace.length });
      }
      if (Object.keys(fields).length === 0) return;
      const stale = [...(staleTraces.get(lobbyId) ?? [])];
      const key = desksKey(lobbyId);
      const tx = redis.multi().hset(key, fields).expire(key, ROOM_TTL_S);
      for (const { key: list, reset, entries } of lists) {
        if (reset) tx.del(list);
        if (entries.length) tx.rpush(list, ...entries);
        tx.expire(list, ROOM_TTL_S);
      }
      for (const desk of stale)
        tx.del(traceKey(lobbyId, desk)).expire(traceKey(lobbyId, desk), ROOM_TTL_S);
      try {
        const results = await tx.exec();
        if (!results) throw new Error(`room ${lobbyId}: desks transaction aborted`);
        for (const [err] of results) if (err) throw err;
        const pending = staleTraces.get(lobbyId);
        for (const desk of stale) pending?.delete(desk);
        if (pending?.size === 0) staleTraces.delete(lobbyId);
      } catch (err) {
        // At-least-once mirror: forget what was "mirrored", so the next flush rewrites these lists.
        for (const desk of desks) cache.delete(desk);
        if (rooms.get(lobbyId) === runtime && runtime.phase === "running") {
          for (const desk of desks) runtime.dirty.add(desk);
        }
        throw err;
      }
    },

    end(lobbyId) {
      const runtime = rooms.get(lobbyId);
      if (runtime) runtime.phase = "ended";
    },

    release(lobbyId) {
      const runtime = rooms.get(lobbyId);
      if (!runtime) return;
      runtime.phase = "ended";
      runtime.states.clear();
      runtime.dirty.clear();
      runtime.budgets.clear();
      mirrored.delete(lobbyId);
    },

    close: (lobbyId) => {
      rooms.delete(lobbyId);
      mirrored.delete(lobbyId);
      staleTraces.delete(lobbyId);
    },
  };
}
