import type { RaceEvent, Snapshot } from "@fifth-copy/protocol";
import { PROTOCOL_VERSION } from "@fifth-copy/protocol";
import type { Clock, Scheduler, TimerHandle } from "../clock";
import type { DesksState, RoomRuntime } from "./desks-state";
import { collectSnapshot, diffRanks, raceElapsed } from "./live-rank";

/** Snapshot period (ADR 0006 point 4: 10 Hz). */
export const TICK_MS = 100;
/** With nothing to flush, how often a running room's hash is checked for a Redis loss (#204). */
export const LOST_PROBE_MS = 1_000;

export type TickEmit = {
  /** To everyone in the room. */
  room(lobbyId: string, event: "snapshot", payload: Snapshot): void;
  room(lobbyId: string, event: "event", payload: RaceEvent): void;
  /** To the sockets of one desk (a user's tabs share it). */
  desk(lobbyId: string, desk: number, payload: RaceEvent): void;
};

/**
 * One extra step of a running room's tick, run before the mirror flush and the snapshot so what it
 * changes (through `desksState.set`) is in that very tick's snapshot and terminal check. Never run
 * on the final tick of `finish`: the ranking is already decided. Synchronous, Redis-free.
 */
export type TickStep = (runtime: RoomRuntime, now: number) => void;

export type Ticker = {
  /** Starts the room's 10 Hz loop at GO; the runtime must be open. */
  start(lobbyId: string): void;
  /** One last tick (snapshot and events, no end check), then stop: called as the race ends. */
  finish(lobbyId: string): void;
  /** Stops the loop without a tick (room closed). */
  stop(lobbyId: string): void;
  /** Stops every loop (shutdown). */
  close(): void;
};

const log = (msg: string, fields: Record<string, unknown>) =>
  console.log(JSON.stringify({ level: "info", msg, ...fields }));

/**
 * The room's tick (ARCHITECTURE 7.3, 7.9): every `TICK_MS` on the injected scheduler it mirrors the
 * dirty desks to Redis (one MULTI), emits the full `snapshot`, then the events of the rank diff:
 * `overtake`/`passed` to the two desks, `new-leader` and `finished { place }` to the room. A desk
 * that turned terminal triggers `onTerminal` (the lifecycle ends the race when all are). Extension
 * point: `steps` (idle #183; bonuses #190) run first in every tick but the final one.
 * A flush that finds the room hash gone (#204: Redis loss) stops the loop and calls `onLost` once.
 */
export function createTicker({
  desksState,
  clock,
  scheduler,
  emit,
  onTerminal,
  steps = [],
  onLost = () => {},
}: {
  desksState: DesksState;
  clock: Clock;
  scheduler: Scheduler;
  emit: TickEmit;
  onTerminal: (lobbyId: string) => void;
  steps?: readonly TickStep[];
  /** The room's keys are gone mid-race (#204); the loop is already stopped. */
  onLost?: (lobbyId: string, raceId: string) => void;
}): Ticker {
  type Loop = {
    handle: TimerHandle | null;
    ranks: number[];
    announced: Set<number>;
    probedAt: number;
  };
  const loops = new Map<string, Loop>();
  const v = PROTOCOL_VERSION;

  function tick(lobbyId: string, loop: Loop, final: boolean) {
    const runtime = desksState.get(lobbyId);
    if (!runtime) return stop(lobbyId);
    const now = clock.now();
    if (!final) for (const step of steps) step(runtime, now);
    const probe = now - loop.probedAt >= LOST_PROBE_MS;
    if (probe) loop.probedAt = now;
    desksState.flush(lobbyId, { probe }).then(
      ({ lost }) => {
        if (!lost || loops.get(lobbyId) !== loop) return;
        stop(lobbyId);
        log("room lost", { lobby: lobbyId });
        onLost(lobbyId, runtime.raceId);
      },
      (err: unknown) => log("desks flush failed", { lobby: lobbyId, err: String(err) }),
    );

    const { snapshot, ranking } = collectSnapshot(runtime, raceElapsed(runtime, now));
    emit.room(lobbyId, "snapshot", snapshot);

    const { overtakes, newLeader } = diffRanks(loop.ranks, snapshot.ranks);
    loop.ranks = snapshot.ranks;
    for (const { desk, passed } of overtakes) {
      emit.desk(lobbyId, desk, { v, kind: "overtake", desk, passed });
      emit.desk(lobbyId, passed, { v, kind: "passed", desk: passed, by: desk });
    }
    if (newLeader !== null) emit.room(lobbyId, "event", { v, kind: "new-leader", desk: newLeader });

    let terminal = false;
    for (const { desk, status, place } of ranking) {
      if (status === "typing" || status === "line-cut" || loop.announced.has(desk)) continue;
      loop.announced.add(desk);
      terminal = true;
      if (status === "finished") emit.room(lobbyId, "event", { v, kind: "finished", desk, place });
    }
    if (terminal && !final) onTerminal(lobbyId);
  }

  function schedule(lobbyId: string, loop: Loop) {
    loop.handle = scheduler.setTimeout(() => {
      if (loops.get(lobbyId) !== loop) return;
      if (desksState.get(lobbyId)?.phase !== "running") return stop(lobbyId);
      schedule(lobbyId, loop);
      try {
        tick(lobbyId, loop, false);
      } catch (err) {
        log("tick failed", { lobby: lobbyId, err: String(err) });
      }
    }, TICK_MS);
  }

  function stop(lobbyId: string) {
    const loop = loops.get(lobbyId);
    if (loop?.handle) scheduler.clear(loop.handle);
    loops.delete(lobbyId);
  }

  return {
    start(lobbyId) {
      stop(lobbyId);
      const runtime = desksState.get(lobbyId);
      if (!runtime) return;
      // Baseline: the order at GO (every desk at zero, by desk), so the first pass is an event.
      const loop: Loop = {
        handle: null,
        ranks: collectSnapshot(runtime, 0).snapshot.ranks,
        announced: new Set(),
        probedAt: clock.now(),
      };
      loops.set(lobbyId, loop);
      schedule(lobbyId, loop);
    },

    finish(lobbyId) {
      const loop = loops.get(lobbyId);
      if (!loop) return;
      try {
        tick(lobbyId, loop, true);
      } catch (err) {
        log("tick failed", { lobby: lobbyId, err: String(err) });
      }
      stop(lobbyId);
    },

    stop,

    close() {
      for (const lobbyId of [...loops.keys()]) stop(lobbyId);
    },
  };
}
