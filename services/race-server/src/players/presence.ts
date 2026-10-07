import { PROTOCOL_VERSION, type RaceEvent } from "@fifth-copy/protocol";
import type { Clock, Scheduler, TimerHandle } from "../clock";
import type { DesksState } from "../rooms/desks-state";
import type { Durations } from "../rooms/durations";
import type { RoomRegistry } from "../rooms/registry";
import type { ResumeKeys } from "./resume-keys";

/** What the socket edge does after a user's socket closed. */
export type Closed =
  /** Another socket of the user is still open (a second tab): nothing. */
  | "still-connected"
  /** `waiting` or `ended` (or no room): the edge frees the desk (`registry.leave`, `roster`). */
  | "leave"
  /** `countdown` or `running`: the desk is line-cut (or already was, or is past typing). */
  | "kept";

export type Presence = {
  /** A socket of the user opened (synchronous, at connection, before the join is queued). */
  socketOpened(lobbyId: string, userId: string): void;
  /**
   * The registry seated the user's socket at `desk`. In the room's queue: issues (or returns) the
   * user's resume key; with `resume` (the handshake carried that very key) and the desk line-cut,
   * resumes it: status `typing`, grace cancelled, key kept, `event resumed { desk }` to the room.
   */
  seated(
    lobbyId: string,
    userId: string,
    desk: number,
    resume: boolean,
  ): Promise<{ resumeKey: string; resumed: boolean }>;
  /**
   * A socket of the user closed. The last one decides, in the room's queue: `leave` in `waiting`
   * and `ended`; in `countdown`/`running` a typing desk turns `line-cut` (progress kept, clock
   * untouched), `event line-cut { desk }` to the room, the key's TTL becomes `GRACE_MS` and a grace
   * timer runs. The members hash is left alone.
   */
  socketClosed(lobbyId: string, userId: string): Promise<Closed>;
  /** Open sockets of the user on this process. */
  sockets(lobbyId: string, userId: string): number;
  /** Whether the desk's user has an open socket (#183 reads it: idle is decided only while connected). */
  isConnected(lobbyId: string, desk: number): boolean;
  /** The user left the room (desk freed): the resume key goes. */
  left(lobbyId: string, userId: string): Promise<void>;
  /** GO (runtime just opened): desks cut during the countdown get their `line-cut` status. */
  onGo(lobbyId: string): void;
  /**
   * The race is ending (inside `endRace`, before the ranking): every line-cut desk turns `expired`
   * with its frozen progress, its timer is cancelled and its key dropped.
   */
  settle(lobbyId: string): Promise<void>;
  /** The room closed: timers cancelled, every resume key of the room deleted. */
  closeRoom(lobbyId: string): void;
  /** Cancels every grace timer (shutdown). */
  close(): void;
};

type Cut = { userId: string; key: string; timer: TimerHandle };

const log = (msg: string, fields: Record<string, unknown>) =>
  console.log(JSON.stringify({ level: "info", msg, ...fields }));

/**
 * Maps socket connectivity to desk status (#178; ADR 0006, 0008; ARCHITECTURE 7.1 `typing ->
 * line-cut -> typing | expired`, 7.4). Socket counts and grace timers live in this process only (a
 * restart voids running rooms, #204); the resume keys live in Redis (`resume-keys.ts`). Every
 * decision runs in the registry's room queue, so it never interleaves with GO or the race end.
 * The key resolves a desk only through the handshake, after the token (ADR 0009); this module
 * never logs it.
 */
export function createPresence({
  registry,
  desksState,
  resumeKeys,
  clock,
  scheduler,
  durations,
  emit,
}: {
  registry: RoomRegistry;
  desksState: DesksState;
  resumeKeys: ResumeKeys;
  clock: Clock;
  scheduler: Scheduler;
  durations: Pick<Durations, "GRACE_MS">;
  /** `event` to the room (`line-cut`, `resumed`). */
  emit: (lobbyId: string, event: RaceEvent) => void;
}): Presence {
  const counts = new Map<string, number>();
  /** Per room: userId -> desk and resume key, from `seated`. */
  const seats = new Map<string, Map<string, { desk: number; key: string }>>();
  /** Per room: line-cut desks awaiting their user. */
  const cuts = new Map<string, Map<number, Cut>>();
  const v = PROTOCOL_VERSION;
  /** Set by `close()`: the sockets closing at shutdown arm no grace timer. */
  let shut = false;

  const userKey = (lobbyId: string, userId: string) => `${lobbyId}\u0000${userId}`;
  const sockets = (lobbyId: string, userId: string) => counts.get(userKey(lobbyId, userId)) ?? 0;
  const cutsOf = (lobbyId: string) => {
    let room = cuts.get(lobbyId);
    if (!room) cuts.set(lobbyId, (room = new Map()));
    return room;
  };

  /** Sets the runtime status of a running desk currently at `from`. */
  function setStatus(
    lobbyId: string,
    desk: number,
    from: "typing" | "line-cut",
    to: "line-cut" | "typing" | "expired",
  ) {
    const runtime = desksState.get(lobbyId);
    const state = runtime?.states.get(desk);
    if (runtime?.phase !== "running" || state?.status !== from) return;
    // `lastKeyAt` restarts at the resume, so idle (#183) never counts the time away.
    const lastKeyAt = to === "typing" ? clock.now() : state.lastKeyAt;
    desksState.set(lobbyId, desk, { ...state, status: to, lastKeyAt });
  }

  /** Line-cut -> expired with the frozen progress; the key goes. Caller is in the room's queue. */
  async function expireDesk(lobbyId: string, desk: number, cut: Cut) {
    scheduler.clear(cut.timer);
    cuts.get(lobbyId)?.delete(desk);
    setStatus(lobbyId, desk, "line-cut", "expired");
    await resumeKeys.drop(lobbyId, cut.userId);
  }

  /** The grace ran out: the next tick sees `expired` and asks the lifecycle (all terminal?). */
  function onGraceEnd(lobbyId: string, desk: number, cut: Cut) {
    registry
      .withRoom(lobbyId, async () => {
        if (cuts.get(lobbyId)?.get(desk) !== cut) return;
        await expireDesk(lobbyId, desk, cut);
        log("grace expired", { lobby: lobbyId, desk });
      })
      .catch((err: unknown) => log("grace expiry failed", { lobby: lobbyId, err: String(err) }));
  }

  return {
    socketOpened(lobbyId, userId) {
      const key = userKey(lobbyId, userId);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    },

    seated: (lobbyId, userId, desk, resume) =>
      registry.withRoom(lobbyId, async () => {
        const resumeKey = await resumeKeys.issue(lobbyId, userId, desk);
        let room = seats.get(lobbyId);
        if (!room) seats.set(lobbyId, (room = new Map()));
        room.set(userId, { desk, key: resumeKey });
        const cut = cuts.get(lobbyId)?.get(desk);
        if (!resume || cut?.userId !== userId || sockets(lobbyId, userId) === 0) {
          return { resumeKey, resumed: false };
        }
        scheduler.clear(cut.timer);
        cuts.get(lobbyId)?.delete(desk);
        setStatus(lobbyId, desk, "line-cut", "typing");
        await resumeKeys.keep(cut.key);
        emit(lobbyId, { v, kind: "resumed", desk });
        log("resumed", { lobby: lobbyId, desk });
        return { resumeKey, resumed: true };
      }),

    socketClosed(lobbyId, userId) {
      const key = userKey(lobbyId, userId);
      const left = (counts.get(key) ?? 1) - 1;
      if (left > 0) {
        counts.set(key, left);
        return Promise.resolve("still-connected");
      }
      counts.delete(key);
      if (shut) return Promise.resolve("kept");
      return registry.withRoom(lobbyId, async (): Promise<Closed> => {
        // A socket of the user reopened while this waited in the queue.
        if (sockets(lobbyId, userId) > 0) return "still-connected";
        const room = await registry.room(lobbyId);
        if (room?.phase !== "countdown" && room?.phase !== "running") return "leave";
        const desk = (room.desks ?? room.seated).find((d) => d.userId === userId)?.desk;
        if (desk === undefined) return "leave";
        if (cuts.get(lobbyId)?.has(desk)) return "kept";
        // Past typing (finished, expired, asleep, abandoned): nothing left to keep.
        const state = desksState.get(lobbyId)?.states.get(desk);
        if (room.phase === "running" && state && state.status !== "typing") return "kept";

        const resumeKey =
          seats.get(lobbyId)?.get(userId)?.key ?? (await resumeKeys.issue(lobbyId, userId, desk));
        await resumeKeys.grace(resumeKey, durations.GRACE_MS);
        const cut: Cut = {
          userId,
          key: resumeKey,
          timer: scheduler.setTimeout(() => onGraceEnd(lobbyId, desk, cut), durations.GRACE_MS),
        };
        cutsOf(lobbyId).set(desk, cut);
        setStatus(lobbyId, desk, "typing", "line-cut");
        emit(lobbyId, { v, kind: "line-cut", desk });
        log("line cut", { lobby: lobbyId, desk });
        return "kept";
      });
    },

    sockets,

    isConnected(lobbyId, desk) {
      for (const [userId, seat] of seats.get(lobbyId) ?? []) {
        if (seat.desk === desk) return sockets(lobbyId, userId) > 0;
      }
      return false;
    },

    left: (lobbyId, userId) =>
      registry.withRoom(lobbyId, async () => {
        seats.get(lobbyId)?.delete(userId);
        await resumeKeys.drop(lobbyId, userId);
      }),

    onGo(lobbyId) {
      for (const desk of cuts.get(lobbyId)?.keys() ?? []) {
        setStatus(lobbyId, desk, "typing", "line-cut");
      }
    },

    async settle(lobbyId) {
      for (const [desk, cut] of [...(cuts.get(lobbyId) ?? [])]) {
        await expireDesk(lobbyId, desk, cut);
      }
    },

    closeRoom(lobbyId) {
      for (const cut of cuts.get(lobbyId)?.values() ?? []) scheduler.clear(cut.timer);
      cuts.delete(lobbyId);
      seats.delete(lobbyId);
      resumeKeys
        .dropRoom(lobbyId)
        .catch((err: unknown) =>
          log("resume keys drop failed", { lobby: lobbyId, err: String(err) }),
        );
    },

    close() {
      shut = true;
      for (const room of cuts.values()) for (const cut of room.values()) scheduler.clear(cut.timer);
      cuts.clear();
    },
  };
}
