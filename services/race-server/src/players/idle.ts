import { MAX_RACE_MS, PROTOCOL_VERSION, type RaceEvent, type Rejected } from "@fifth-copy/protocol";
import type { DesksState, RoomRuntime } from "../rooms/desks-state";
import type { Durations } from "../rooms/durations";
import type { Presence } from "./presence";

export type AbandonResult = {
  /** Sent back as `rejected`: no running race (or it is ending), or the desk is not typing. */
  rejected?: Extract<Rejected["reason"], "not-running">;
  /** The desk turned `abandoned` (the caller asks the lifecycle whether every desk is done). */
  terminal: boolean;
};

export type Idle = {
  /** The tick step (`rooms/tick.ts` `TickStep`): warns, then puts to sleep, silent connected desks. */
  step(runtime: RoomRuntime, now: number): void;
  /** `abandon` from a seated desk: `typing` -> `abandoned`, its engine state frozen as is. */
  abandon(lobbyId: string, desk: number): AbandonResult;
  /** The room closed: its warning markers go. */
  closeRoom(lobbyId: string): void;
};

/**
 * The two exits of a desk short of finishing (#183; ADR 0006, 0007; ARCHITECTURE 7.1, 7.4; spec
 * 4.4, 4.5): silence and abandon. Each tick, a `typing` desk whose user has an open socket and no
 * accepted keystroke for `IDLE_WARN_MS` gets one `idle-warning { desk, kickAt }` to the room
 * (`kickAt` in ms since GO), and at `IDLE_KICK_MS` turns `asleep` (`asleep { desk }`); a line-cut
 * desk is never idle (presence's grace decides it). The silence is measured from the desk's
 * `lastKeyAt`, which ingest moves at every accepted batch and presence at a resume, so neither
 * knows about idling. The warning marker lives in this process only (ADR 0008, like presence's
 * timers): a desk is warned for the silence that started at the `lastKeyAt` it holds, and any newer
 * `lastKeyAt` opens a fresh window. Status writes go through `desksState.set`; the tick's terminal
 * check then asks the lifecycle to end the race. Bots hold no seat in presence and are never idle.
 * Neither runs in the room queue: once `endRace` marks the runtime `ending`, both stand down
 * (abandon is `not-running`), so no exit lands after the ranking was taken.
 */
export function createIdle({
  desksState,
  presence,
  durations,
  emit,
}: {
  desksState: DesksState;
  presence: Pick<Presence, "isConnected">;
  durations: Pick<Durations, "IDLE_WARN_MS" | "IDLE_KICK_MS">;
  /** `event` to the room (`idle-warning`, `asleep`, `abandoned`). */
  emit: (lobbyId: string, event: RaceEvent) => void;
}): Idle {
  /** Per room: desk -> the `lastKeyAt` of the silence it was warned for. */
  const warned = new Map<string, Map<number, number>>();
  const v = PROTOCOL_VERSION;

  return {
    step(runtime, now) {
      if (runtime.phase !== "running" || runtime.ending) return;
      const { lobbyId, t0 } = runtime;
      let room = warned.get(lobbyId);
      for (const [desk, state] of runtime.states) {
        if (state.status !== "typing" || !presence.isConnected(lobbyId, desk)) continue;
        const silent = now - state.lastKeyAt;
        if (silent >= durations.IDLE_KICK_MS) {
          desksState.set(lobbyId, desk, { ...state, status: "asleep" });
          room?.delete(desk);
          emit(lobbyId, { v, kind: "asleep", desk });
        } else if (silent >= durations.IDLE_WARN_MS && room?.get(desk) !== state.lastKeyAt) {
          if (!room) warned.set(lobbyId, (room = new Map()));
          room.set(desk, state.lastKeyAt);
          const kickAt = state.lastKeyAt - t0 + durations.IDLE_KICK_MS;
          emit(lobbyId, {
            v,
            kind: "idle-warning",
            desk,
            kickAt: Math.min(MAX_RACE_MS, Math.max(0, kickAt)),
          });
        }
      }
    },

    abandon(lobbyId, desk) {
      const runtime = desksState.get(lobbyId);
      const state = runtime?.states.get(desk);
      if (runtime?.phase !== "running" || runtime.ending || state?.status !== "typing") {
        return { rejected: "not-running", terminal: false };
      }
      desksState.set(lobbyId, desk, { ...state, status: "abandoned" });
      warned.get(lobbyId)?.delete(desk);
      emit(lobbyId, { v, kind: "abandoned", desk });
      return { terminal: true };
    },

    closeRoom(lobbyId) {
      warned.delete(lobbyId);
    },
  };
}
