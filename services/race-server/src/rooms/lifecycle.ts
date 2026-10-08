import { randomUUID } from "node:crypto";
import {
  charsOf,
  normalizeTypeable,
  type PlayerState,
  type PlayerStatus,
} from "@fifth-copy/engine";
import {
  MAX_RACE_MS,
  PROTOCOL_VERSION,
  startRaceResponseSchema,
  type EndReason,
  type HostStartAck,
  type RaceInfo,
  type RaceRole,
  type RaceSettings,
  type RankingEntry,
  type ServerToClientEvents,
} from "@fifth-copy/protocol";
import type { Clock, Scheduler, TimerHandle } from "../clock";
import type { WebApi } from "../persist/web-api";
import type { Durations } from "./durations";
import { rankingFor } from "./ranking";
import type { RaceDesk, RoomRegistry } from "./registry";

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
  /** Ms since GO at the end, clamped to `[0, MAX_RACE_MS]`: the ranking's race elapsed time. */
  elapsedMs: number;
};

export type Lifecycle = {
  /**
   * `host:start` (ADR 0006): authorised here, not only at the edge. Never rejects: a failure of the
   * web start call or of Redis is `start-failed`, with nothing emitted and the phase unchanged.
   */
  start(lobbyId: string, by: { sub: string; role: RaceRole }): Promise<HostStartAck>;
  /**
   * The one exit of a race: timer (here), all-finished (#173), void (#204). Idempotent. A room whose
   * keys are gone while its race runs in this process is voided (`voidRoom`), never left frozen.
   */
  endRace(lobbyId: string, reason: EndReason): Promise<void>;
  /**
   * The room's keys are gone mid-race (#204: Redis loss, seen by the tick): `ended { void }` with an
   * empty ranking to the room, nothing persisted, the room dropped from this process and its leftover
   * keys deleted. Only for the race `raceId` still running here; idempotent.
   */
  voidRoom(lobbyId: string, raceId: string): Promise<void>;
  /** A desk reached a terminal status (#173): ends the race when every desk is terminal. */
  onDeskTerminal(lobbyId: string): Promise<void>;
  /** The room was closed (its keys deleted): its timers are cancelled, nothing is emitted. */
  onRoomClosed(lobbyId: string): void;
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
  onEnding = async () => {},
  onGo = () => {},
  onEnded = () => {},
  onClosed = () => {},
  liveRace = () => null,
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
  /**
   * The race is ending, before the ranking is computed, inside the room's queue (#178: line-cut
   * desks turn `expired`). Must not call the registry's queued methods.
   */
  onEnding?: (lobbyId: string) => Promise<void>;
  /** The room is `running` (#173: the desks' runtime and the tick loop start here). */
  onGo?: (
    lobbyId: string,
    init: { race: RaceInfo; settings: RaceSettings; desks: RaceDesk[] },
  ) => void;
  /** The race is ending: ranked, phase `ended`, `ended` not yet emitted (#173: last tick, keys refused). */
  onEnded?: (lobbyId: string) => void;
  /** The room closed (#173: the tick loop and the runtime are dropped). */
  onClosed?: (lobbyId: string) => void;
  /** The race running in this process for the room (#204: the desks' runtime), else null. */
  liveRace?: (lobbyId: string) => { raceId: string; t0: number; desks: number[] } | null;
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

  /**
   * The room was lost with its race on (#204), inside its queue: everything of the room in this
   * process stops first (so no tick rewrites a key), the room hears `ended { void }`, then the
   * leftover keys go (best effort) and `onRaceEnded` sees the void (nothing is persisted).
   */
  async function lose(lobbyId: string, raceId: string) {
    const live = liveRace(lobbyId);
    const now = clock.now();
    const elapsed = live ? Math.min(Math.max(0, now - live.t0), MAX_RACE_MS) : 0;
    cancel(lobbyId);
    try {
      onClosed(lobbyId);
    } catch (err) {
      log("onClosed failed", { lobby: lobbyId, err: String(err) });
    }
    emit(lobbyId, "ended", { v: PROTOCOL_VERSION, raceId, reason: "void", ranking: [] });
    log("ended", { lobby: lobbyId, reason: "void", desks: 0 });
    await registry
      .voidRoom(lobbyId, live?.desks ?? [])
      .catch((err: unknown) => log("void cleanup failed", { lobby: lobbyId, err: String(err) }));
    try {
      onRaceEnded({
        lobbyId,
        raceId,
        reason: "void",
        ranking: [],
        endedAt: now,
        elapsedMs: elapsed,
      });
    } catch (err) {
      log("onRaceEnded failed", { lobby: lobbyId, err: String(err) });
    }
  }

  const goRunning = (lobbyId: string, raceId: string) =>
    registry.withRoom(lobbyId, async () => {
      const room = await registry.room(lobbyId);
      // Lost during the countdown (#204): GO never comes, the clients must not wait for it.
      if (room === null) return lose(lobbyId, raceId);
      if (room.phase !== "countdown" || room.race?.raceId !== raceId) return;
      await registry.setPhase(lobbyId, "running");
      onGo(lobbyId, { race: room.race, settings: room.settings, desks: room.desks ?? room.seated });
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
        const live = room === null ? liveRace(lobbyId) : null;
        if (live) return lose(lobbyId, live.raceId);
        if (!room?.race || (room.phase !== "countdown" && room.phase !== "running")) {
          // Ended already, or the room closed: nothing left to end, no timer left to fire.
          cancel(lobbyId);
          return;
        }
        const { race } = room;
        const now = clock.now();
        const elapsed = Math.min(Math.max(0, now - race.t0), MAX_RACE_MS);
        try {
          await onEnding(lobbyId);
        } catch (err) {
          log("onEnding failed", { lobby: lobbyId, err: String(err) });
        }
        const ranking = rankingFor(
          room.desks ?? room.seated,
          await deskStates(lobbyId),
          charsOf(normalizeTypeable(race.text)).length,
          elapsed,
        );
        await registry.setPhase(lobbyId, "ended");
        cancel(lobbyId);
        try {
          onEnded(lobbyId);
        } catch (err) {
          log("onEnded failed", { lobby: lobbyId, err: String(err) });
        }
        emit(lobbyId, "ended", { v: PROTOCOL_VERSION, raceId: race.raceId, reason, ranking });
        log("ended", { lobby: lobbyId, reason, desks: ranking.length });
        try {
          onRaceEnded({
            lobbyId,
            raceId: race.raceId,
            reason,
            ranking,
            endedAt: now,
            elapsedMs: elapsed,
          });
        } catch (err) {
          log("onRaceEnded failed", { lobby: lobbyId, err: String(err) });
        }
      }),

    voidRoom: (lobbyId, raceId) =>
      registry.withRoom(lobbyId, async () => {
        if (liveRace(lobbyId)?.raceId !== raceId) return;
        await lose(lobbyId, raceId);
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

    onRoomClosed: (lobbyId) => {
      cancel(lobbyId);
      onClosed(lobbyId);
    },

    close: () => {
      for (const lobbyId of [...timers.keys()]) cancel(lobbyId);
    },
  };
  return lifecycle;
}
