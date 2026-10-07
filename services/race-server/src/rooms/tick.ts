import type { RaceEvent, Snapshot } from "@fifth-copy/protocol";
import { PROTOCOL_VERSION } from "@fifth-copy/protocol";
import type { Clock, Scheduler, TimerHandle } from "../clock";
import type { DesksState } from "./desks-state";
import { collectSnapshot, diffRanks, raceElapsed } from "./live-rank";

/** Snapshot period (ADR 0006 point 4: 10 Hz). */
export const TICK_MS = 100;

export type TickEmit = {
  /** To everyone in the room. */
  room(lobbyId: string, event: "snapshot", payload: Snapshot): void;
  room(lobbyId: string, event: "event", payload: RaceEvent): void;
  /** To the sockets of one desk (a user's tabs share it). */
  desk(lobbyId: string, desk: number, payload: RaceEvent): void;
};

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
 * point: bonuses (#190) and idle (#183) add a step to `tick`.
 */
export function createTicker({
  desksState,
  clock,
  scheduler,
  emit,
  onTerminal,
}: {
  desksState: DesksState;
  clock: Clock;
  scheduler: Scheduler;
  emit: TickEmit;
  onTerminal: (lobbyId: string) => void;
}): Ticker {
  type Loop = { handle: TimerHandle | null; ranks: number[]; announced: Set<number> };
  const loops = new Map<string, Loop>();
  const v = PROTOCOL_VERSION;

  function tick(lobbyId: string, loop: Loop, final: boolean) {
    const runtime = desksState.get(lobbyId);
    if (!runtime) return stop(lobbyId);
    desksState
      .flush(lobbyId)
      .catch((err: unknown) => log("desks flush failed", { lobby: lobbyId, err: String(err) }));

    const { snapshot, ranking } = collectSnapshot(runtime, raceElapsed(runtime, clock.now()));
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
