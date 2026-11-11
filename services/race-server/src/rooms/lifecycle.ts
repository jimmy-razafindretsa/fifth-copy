import { randomUUID } from "node:crypto";
import { charsOf, normalizeTypeable, type PlayerStatus } from "@fifth-copy/engine";
import {
  MAX_RACE_MS,
  PROTOCOL_VERSION,
  startRaceResponseSchema,
  type EndReason,
  type HostStartAck,
  type Phase,
  type RaceInfo,
  type RaceRole,
  type RaceSettings,
  type RankingEntry,
  type ServerToClientEvents,
} from "@fifth-copy/protocol";
import type { Clock, Scheduler, TimerHandle } from "../clock";
import type { WebApi } from "../persist/web-api";
import type { Durations } from "./durations";
import { rankingFor, type RankedState } from "./ranking";
import type { BotSeat } from "./bot-driver";
import type { RaceDesk, RoomRegistry, RoomState } from "./registry";

/** The room broadcasts the lifecycle sends; implemented by the socket edge with `io.to(room)`. */
type RoomEvents = Pick<ServerToClientEvents, "countdown" | "ended" | "auto-start">;
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
   * The room's automatic start (#814), the one decision, in the room's queue: after every join,
   * leave and re-seat. An eligible room (`autoStartEligible`) with no instant pending is armed
   * (`autoStartAt = now + AUTO_START_MS` in the room hash, one timer, `auto-start` to the room); a
   * room already armed is left alone (a later join never moves it); a room no longer eligible is
   * dropped (instant deleted, timer cleared, `auto-start { null }`). Never rejects.
   */
  reviewAutoStart(lobbyId: string): Promise<void>;
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
/**
 * The phases a host start leaves from (ARCHITECTURE 7.1): `waiting`, and `ended` for "Race again"
 * (#143: same room, same members, bots and settings, a new race). The seam a later automatic
 * Race again (#128) reuses with `onRestart`.
 */
export const canStart = (phase: Phase): boolean => phase === "waiting" || phase === "ended";

/**
 * Whether a room starts by itself (#814; spec 4.1 rule 2): a `waiting` public room with at least one
 * human and at least two desks in all (bots count). Only the first race: an ended room waits for the
 * host's START (owner decision 2026-11-04). The seam a later rule (late-join floor, per-room wait)
 * changes.
 */
export function autoStartEligible(room: Pick<RoomState, "phase" | "settings" | "seated">): boolean {
  if (room.phase !== "waiting" || room.settings.lobbyType !== "public") return false;
  return room.seated.length >= 2 && room.seated.some(({ isBot }) => !isBot);
}

/** Who starts a race: the host's socket (`host:start`), or the room's own clock (#814). */
type Starter = { sub: string; role: RaceRole } | "room";

/** Bound on the web start call (card #166); the room's queue waits for it. */
export const START_TIMEOUT_MS = 5_000;

const log = (msg: string, fields: Record<string, unknown>) =>
  console.log(JSON.stringify({ level: "info", msg, ...fields }));

/**
 * The room's phase transitions and clock (ADR 0006, 0008; ARCHITECTURE 7.1): `waiting ->
 * countdown` (or `ended -> countdown`, "Race again", #143) on a host start with >= 2 desks, `countdown -> running` at GO (`t0`), `running ->
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
  onRestart = () => {},
  liveRace = () => null,
  leavePending = () => false,
  syncHost = async () => true,
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
  deskStates?: (lobbyId: string) => Promise<ReadonlyMap<number, RankedState>>;
  /**
   * The race is ending, before the ranking is computed, inside the room's queue (#178: line-cut
   * desks turn `expired`). Must not call the registry's queued methods.
   */
  onEnding?: (lobbyId: string) => Promise<void>;
  /**
   * The room is `running` (#173: the desks' runtime and the tick loop start here; #366: `bots`, the
   * bot desks of the race with their level from the members hash, get their drivers).
   */
  onGo?: (
    lobbyId: string,
    init: { race: RaceInfo; settings: RaceSettings; desks: RaceDesk[]; bots: BotSeat[] },
  ) => void;
  /** The race is ending: ranked, phase `ended`, `ended` not yet emitted (#173: last tick, keys refused). */
  onEnded?: (lobbyId: string) => void;
  /** The room closed (#173: the tick loop and the runtime are dropped). */
  onClosed?: (lobbyId: string) => void;
  /**
   * An ended room starts again (#143), before its new race is written and `countdown` emitted:
   * the previous race's in-process state (tick loop, desks' runtime, idle warnings) is dropped.
   */
  onRestart?: (lobbyId: string) => void;
  /** The race running in this process for the room (#204: the desks' runtime), else null. */
  liveRace?: (lobbyId: string) => { raceId: string; t0: number; desks: number[] } | null;
  /**
   * A leave of the room is waiting out its grace (#890: the host with others #884, or the last
   * human #734; `lastLeave.pending`). The automatic start holds while it does; the grace's end
   * reviews the room again (`reviewAutoStart`), which fires the kept instant or drops it.
   */
  leavePending?: (lobbyId: string) => boolean;
  /**
   * Delivers the room's pending host transfer to the web before a start call (#897): the web refuses
   * a start whose `hostUserId` is not its recorded `Lobby.hostUserId`, and the transfer (#137) rides
   * the outbox. `false` or a rejection fails the start (`start-failed`); a later start tries again.
   */
  syncHost?: (lobbyId: string) => Promise<boolean>;
}): Lifecycle {
  const timers = new Map<string, TimerHandle[]>();
  /** The pending automatic start of each armed room (#814), apart so a start clears it alone. */
  const autoTimers = new Map<string, TimerHandle>();

  function clearAuto(lobbyId: string) {
    const handle = autoTimers.get(lobbyId);
    if (handle) scheduler.clear(handle);
    autoTimers.delete(lobbyId);
  }

  function cancel(lobbyId: string) {
    for (const handle of timers.get(lobbyId) ?? []) scheduler.clear(handle);
    timers.delete(lobbyId);
    clearAuto(lobbyId);
  }

  const autoLog = (lobbyId: string, outcome: string) =>
    log("auto-start", { lobby: lobbyId, outcome });

  /** One timer for the room's automatic start at `when` (server ms epoch). */
  function armAuto(lobbyId: string, when: number) {
    clearAuto(lobbyId);
    autoTimers.set(
      lobbyId,
      scheduler.setTimeout(() => {
        autoTimers.delete(lobbyId);
        fireAuto(lobbyId).catch((err: unknown) =>
          log("auto-start failed", { lobby: lobbyId, err: String(err) }),
        );
      }, when - clock.now()),
    );
  }

  /** Inside the queue: the instant goes, the timer goes, the room hears `null`. */
  async function dropAuto(lobbyId: string, outcome: string) {
    clearAuto(lobbyId);
    await registry.setAutoStart(lobbyId, null);
    emit(lobbyId, "auto-start", { v: PROTOCOL_VERSION, startsAt: null });
    autoLog(lobbyId, outcome);
  }

  /** The instant came (#814): the same `begin` as a host START, on the room's behalf. */
  const fireAuto = (lobbyId: string) =>
    registry.withRoom(lobbyId, async () => {
      const room = await registry.room(lobbyId);
      // Dropped or started meanwhile: nothing pending any more.
      if (!room || room.autoStartAt === null) return;
      // A leave grace is pending (#890): the instant stays stored, with no timer, until the grace
      // resolves and its review re-arms it (at once, the instant being past) or drops it.
      if (leavePending(lobbyId)) return autoLog(lobbyId, "held");
      let result;
      try {
        result = await begin(lobbyId, "room");
      } catch (err) {
        log("start", { lobby: lobbyId, outcome: "start-failed", cause: String(err) });
        result = { ok: false, error: "start-failed" } as const;
      }
      if (result.ok) return autoLog(lobbyId, "ok");
      // The room stays `waiting`; the host's START remains.
      await dropAuto(lobbyId, result.error);
    });

  /** The one automatic-start decision (#814), inside the room's queue. */
  async function review(lobbyId: string) {
    const room = await registry.room(lobbyId);
    if (!room) return clearAuto(lobbyId);
    const eligible = autoStartEligible(room);
    if (!eligible) {
      if (room.autoStartAt !== null) await dropAuto(lobbyId, "dropped");
      else clearAuto(lobbyId);
      return;
    }
    if (room.autoStartAt !== null) {
      // Armed already: never reset nor extended. A stored instant with no timer here (another
      // process armed it before a drain, #704) gets its timer at that same instant.
      if (!autoTimers.has(lobbyId)) armAuto(lobbyId, room.autoStartAt);
      return;
    }
    const startsAt = clock.now() + durations.AUTO_START_MS;
    await registry.setAutoStart(lobbyId, startsAt);
    armAuto(lobbyId, startsAt);
    emit(lobbyId, "auto-start", { v: PROTOCOL_VERSION, startsAt });
    autoLog(lobbyId, "armed");
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
      const levels = await registry.botLevels(lobbyId);
      await registry.setPhase(lobbyId, "running");
      const desks = room.desks ?? room.seated;
      // A bot desk always has its level (#156 seats it); "clerk" only guards a hand-edited hash.
      const bots = desks
        .filter(({ isBot }) => isBot)
        .map(({ desk }): BotSeat => ({ desk, level: levels.get(desk) ?? "clerk" }));
      onGo(lobbyId, { race: room.race, settings: room.settings, desks, bots });
    });

  /**
   * The one start path: a host START (`by` the socket's claims, authorised here) or the room's
   * automatic start (`"room"`, #814: authorised by the room's own clock, so it fires even after the
   * host's socket left; `hostUserId` still names the host to the web).
   */
  async function begin(lobbyId: string, by: Starter) {
    const room = await registry.room(lobbyId);
    if (!room) return { ok: false, error: "not-waiting" } as const;
    // The host is the room hash's `hostUserId` (ADR 0009), whatever role its token was minted with: a
    // host promoted after its token (#137) holds a `player` token. A spectator socket never hosts.
    if (by !== "room" && (by.role === "spectator" || by.sub !== room.hostUserId)) {
      return { ok: false, error: "not-host" } as const;
    }
    // `not-waiting`: a race is on (countdown or running).
    if (!canStart(room.phase)) return { ok: false, error: "not-waiting" } as const;
    if (room.seated.length < 2) return { ok: false, error: "too-few" } as const;

    const raceId = randomUUID();
    let text;
    try {
      // The web checks the host against its own record: the room's transfer lands there first.
      if (!(await withTimeout(syncHost(lobbyId), START_TIMEOUT_MS))) {
        throw new Error("host transfer undelivered");
      }
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
    if (room.phase === "ended") {
      try {
        onRestart(lobbyId);
      } catch (err) {
        log("onRestart failed", { lobby: lobbyId, err: String(err) });
      }
    }
    // `startRace` deletes the stored instant; its timer goes here. `countdown` supersedes it.
    clearAuto(lobbyId);
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

    reviewAutoStart: (lobbyId) =>
      registry
        .withRoom(lobbyId, () => review(lobbyId))
        .catch((err: unknown) => log("auto-start failed", { lobby: lobbyId, err: String(err) })),

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
      for (const lobbyId of [...timers.keys(), ...autoTimers.keys()]) cancel(lobbyId);
    },
  };
  return lifecycle;
}
