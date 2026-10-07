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
import { desksKey, ROOM_TTL_S } from "./keys";
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
   * Writes the dirty desks to `room:<id>:desks` in one MULTI with the room TTL, then clears them.
   * No Redis call when nothing changed. On failure the desks stay dirty for the next tick.
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
 * The JSON of a trace, extended with only the keystrokes appended since the last call: a tick never
 * re-serialises a desk's whole history (the remaining per-tick cost is the Redis write, #592).
 */
type TraceJson = { trace: readonly Keystroke[]; length: number; json: string };

function serialise(state: DeskState, cache: Map<number, TraceJson>, desk: number): string {
  const { trace, ...rest } = state;
  let entry = cache.get(desk);
  if (entry?.trace !== trace || entry.length > trace.length) {
    entry = { trace, length: 0, json: "" };
    cache.set(desk, entry);
  }
  for (let i = entry.length; i < trace.length; i++) {
    entry.json += (i === 0 ? "" : ",") + JSON.stringify(trace[i]);
  }
  entry.length = trace.length;
  const head = JSON.stringify(rest);
  return `${head.slice(0, -1)}${head.length > 2 ? "," : ""}"trace":[${entry.json}]}`;
}

export function createDesksState({ redis }: { redis: Redis }): DesksState {
  const rooms = new Map<string, RoomRuntime>();
  const traces = new Map<string, Map<number, TraceJson>>();

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
      rooms.set(lobbyId, runtime);
      traces.set(lobbyId, new Map());
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
      // Serialised now, so a key applied while EXEC is in flight lands in the next flush.
      const fields: Record<string, string> = {};
      const cache = traces.get(lobbyId) ?? new Map<number, TraceJson>();
      for (const desk of desks) {
        const state = runtime.states.get(desk);
        if (state) fields[desk] = serialise(state, cache, desk);
      }
      if (Object.keys(fields).length === 0) return;
      const key = desksKey(lobbyId);
      try {
        const results = await redis.multi().hset(key, fields).expire(key, ROOM_TTL_S).exec();
        if (!results) throw new Error(`room ${lobbyId}: desks transaction aborted`);
        for (const [err] of results) if (err) throw err;
      } catch (err) {
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
      traces.delete(lobbyId);
    },

    close: (lobbyId) => {
      rooms.delete(lobbyId);
      traces.delete(lobbyId);
    },
  };
}
