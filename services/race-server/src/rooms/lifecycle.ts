import { randomUUID } from "node:crypto";
import { charsOf, type PlayerState, type PlayerStatus } from "@fifth-copy/engine";
import {
  MAX_RACE_MS,
  PROTOCOL_VERSION,
  startRaceResponseSchema,
  type EndReason,
  type HostStartAck,
  type RaceInfo,
  type RaceRole,
  type RankingEntry,
  type ServerToClientEvents,
} from "@fifth-copy/protocol";
import type { Clock, Scheduler, TimerHandle } from "../clock";
import type { WebApi } from "../persist/web-api";
import type { Durations } from "./durations";
import { rankingFor } from "./ranking";
import type { RoomRegistry } from "./registry";

/** The room broadcasts the lifecycle sends; implemented by the socket edge with `io.to(room)`. */
type RoomEvents = Pick<ServerToClientEvents, "countdown" | "ended">;
export type Emit = <E extends keyof RoomEvents>(
  lobbyId: string,
  event: E,
  payload: Parameters<RoomEvents[E]>[0],
) => void;

export type RaceEnded = {
  lobbyId: string;
  raceId: string;
  reason: EndReason;
  ranking: RankingEntry[];
  /** Server ms epoch. */
  endedAt: number;
};

export type Lifecycle = {
  /**
   * `host:start` (ADR 0006): authorised here, not only at the edge. Never rejects: a failure of the
   * web start call or of Redis is `start-failed`, with nothing emitted and the phase unchanged.
   */
  start(lobbyId: string, by: { sub: string; role: RaceRole }): Promise<HostStartAck>;
  /** The one exit of a race: timer (here), all-finished (#173), void (#204). Idempotent. */
  endRace(lobbyId: string, reason: EndReason): Promise<void>;
  /** A desk reached a terminal status (#173): ends the race when every desk is terminal. */
  onDeskTerminal(lobbyId: string): Promise<void>;
  /** Cancels every pending timer (shutdown). */
  close(): void;
};

/** Statuses after which a desk never types again in this race (`line-cut` may resume, #178). */
const TERMINAL: ReadonlySet<PlayerStatus> = new Set(["finished", "abandoned", "asleep", "expired"]);
/** Bound on the web start call (card #166); the room's queue waits for it. */
export const START_TIMEOUT_MS = 5_000;

const log = (msg: string, fields: Record<string, unknown>) =>
  console.log(JSON.stringify({ level: "info", msg, ...fields }));

/**
 * The room's phase transitions and clock (ADR 0006, 0008; ARCHITECTURE 7.1): `waiting ->
 * countdown` on a host start with >= 2 desks, `countdown -> running` at GO (`t0`), `running ->
 * ended` through `endRace`. Every transition runs in the registry's per-room queue and writes Redis
 * (the single state) before it emits; only timer handles live in this process.
 */
export function createLifecycle({
  registry,
  clock,
  scheduler,
  webApi,
  durations,
  emit,
  onRaceEnded = () => {},
  deskStates = async () => new Map(),
}: {
  registry: RoomRegistry;
  clock: Clock;
  scheduler: Scheduler;
  webApi: WebApi;
  durations: Durations;
  emit: Emit;
  /** Called once per race, after `ended` is emitted (persistence, #189). */
  onRaceEnded?: (ended: RaceEnded) => void;
  /** Authoritative desk states (#173); a missing desk is `initialState()`. */
  deskStates?: (lobbyId: string) => Promise<ReadonlyMap<number, PlayerState>>;
}): Lifecycle {
  const timers = new Map<string, TimerHandle[]>();

  function cancel(lobbyId: string) {
    for (const handle of timers.get(lobbyId) ?? []) scheduler.clear(handle);
    timers.delete(lobbyId);
  }

  function at(lobbyId: string, when: number, fn: () => Promise<void>) {
    const handle = scheduler.setTimeout(() => {
      fn().catch((err: unknown) =>
        log("lifecycle timer failed", { lobby: lobbyId, err: String(err) }),
      );
    }, when - clock.now());
    timers.set(lobbyId, [...(timers.get(lobbyId) ?? []), handle]);
  }

  /** Rejects after `ms` on the scheduler's clock, so the fake clock drives it in tests. */
  function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const handle = scheduler.setTimeout(() => reject(new Error("timeout")), ms);
      promise.then(
        (value) => {
          scheduler.clear(handle);
          resolve(value);
        },
        (err: unknown) => {
          scheduler.clear(handle);
          reject(err instanceof Error ? err : new Error(String(err)));
        },
      );
    });
  }

  const goRunning = (lobbyId: string, raceId: string) =>
    registry.withRoom(lobbyId, async () => {
      const room = await registry.room(lobbyId);
      if (room?.phase !== "countdown" || room.race?.raceId !== raceId) return;
      await registry.setPhase(lobbyId, "running");
    });

  async function begin(lobbyId: string, by: { sub: string; role: RaceRole }) {
    const room = await registry.room(lobbyId);
    if (!room) return { ok: false, error: "not-waiting" } as const;
    if (by.role !== "host" || by.sub !== room.hostUserId) {
      return { ok: false, error: "not-host" } as const;
    }
    if (room.phase !== "waiting") return { ok: false, error: "not-waiting" } as const;
    if (room.seated.length < 2) return { ok: false, error: "too-few" } as const;

    const raceId = randomUUID();
    let text;
    try {
      const response = startRaceResponseSchema.parse(
        await withTimeout(
          webApi.startRace({
            v: PROTOCOL_VERSION,
            raceId,
            lobbyId,
            hostUserId: room.hostUserId,
            settings: room.settings,
            desks: room.seated,
          }),
          START_TIMEOUT_MS,
        ),
      );
      if (response.raceId !== raceId) throw new Error("raceId mismatch");
      text = response.text;
    } catch (err) {
      // The outcome only, never a body (it may carry the text or a web error page).
      log("start", { lobby: lobbyId, outcome: "start-failed", cause: (err as Error).message });
      return { ok: false, error: "start-failed" } as const;
    }

    const t0 = clock.now() + durations.COUNTDOWN_MS;
    const { timerS } = room.settings;
    // An untimed race still ends on the wire's bound (MAX_RACE_MS, #557), as a timer end.
    const endAt = t0 + (timerS === null ? MAX_RACE_MS : timerS * 1000);
    const race: RaceInfo = {
      raceId,
      text: text.content,
      language: text.language,
      wordCount: text.wordCount,
      t0,
      timerS,
    };
    await registry.startRace(lobbyId, { race, endAt, desks: room.seated });
    at(lobbyId, t0, () => goRunning(lobbyId, raceId));
    at(lobbyId, endAt, () => lifecycle.endRace(lobbyId, "timer"));
    emit(lobbyId, "countdown", { v: PROTOCOL_VERSION, race });
    log("start", { lobby: lobbyId, outcome: "ok", desks: room.seated.length });
    return { ok: true, raceId } as const;
  }

  const lifecycle: Lifecycle = {
    start: (lobbyId, by) =>
      registry
        .withRoom(lobbyId, () => begin(lobbyId, by))
        .catch((err: unknown) => {
          log("start", { lobby: lobbyId, outcome: "start-failed", cause: String(err) });
          return { ok: false, error: "start-failed" } as const;
        }),

    endRace: (lobbyId, reason) =>
      registry.withRoom(lobbyId, async () => {
        const room = await registry.room(lobbyId);
        if (!room?.race || (room.phase !== "countdown" && room.phase !== "running")) {
          // Ended already, or the room closed: nothing left to end, no timer left to fire.
          cancel(lobbyId);
          return;
        }
        const { race } = room;
        const now = clock.now();
        const elapsed = Math.min(Math.max(0, now - race.t0), MAX_RACE_MS);
        const ranking = rankingFor(
          room.desks ?? room.seated,
          await deskStates(lobbyId),
          charsOf(race.text).length,
          elapsed,
        );
        await registry.setPhase(lobbyId, "ended");
        cancel(lobbyId);
        emit(lobbyId, "ended", { v: PROTOCOL_VERSION, raceId: race.raceId, reason, ranking });
        log("ended", { lobby: lobbyId, reason, desks: ranking.length });
        try {
          onRaceEnded({ lobbyId, raceId: race.raceId, reason, ranking, endedAt: now });
        } catch (err) {
          log("onRaceEnded failed", { lobby: lobbyId, err: String(err) });
        }
      }),

    onDeskTerminal: async (lobbyId) => {
      const room = await registry.withRoom(lobbyId, () => registry.room(lobbyId));
      if (room?.phase !== "running") return;
      const states = await deskStates(lobbyId);
      const desks = room.desks ?? room.seated;
      const done = desks.every(({ desk }) => {
        const status = states.get(desk)?.status;
        return status !== undefined && TERMINAL.has(status);
      });
      if (done) await lifecycle.endRace(lobbyId, "all-finished");
    },

    close: () => {
      for (const lobbyId of [...timers.keys()]) cancel(lobbyId);
    },
  };
  return lifecycle;
}
