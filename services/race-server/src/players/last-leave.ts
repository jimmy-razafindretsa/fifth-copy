import type { Scheduler, TimerHandle } from "../clock";
import type { RoomRegistry } from "../rooms/registry";

/**
 * How long the last human of a waiting room may be gone before the room closes (#734), and a host
 * with others in the room before the role passes on (#137, #884). A reload of the lobby page drops
 * the socket and opens a new one within a second or two; the room (and its `Lobby` row, which the
 * close marks CLOSED) and its host must survive it. Not a race duration: never scaled by
 * `RACE_FAST_CLOCK`.
 */
export const LAST_LEAVE_GRACE_MS = 5_000;

export type LastLeave = {
  /**
   * Whether the leave of `userId` would close the room: it is `waiting` and `userId` is its only
   * human. Read in the room's queue.
   */
  closes(lobbyId: string, userId: string): Promise<boolean>;
  /**
   * Whether `userId` hosts a `waiting` or `ended` room with another human seated (#137, #884): a
   * reload of the lobby page, or the Dawn report closing every member's socket, must not pass the
   * role on, so the host's leave waits out the same grace and promotes nobody if the host is back.
   * Only a disconnect asks; an explicit leave (`leaveRoom`) promotes at once. Read in the room's queue.
   */
  hostWithOthers(lobbyId: string, userId: string): Promise<boolean>;
  /**
   * Runs `leave` after `LAST_LEAVE_GRACE_MS` unless the user has a socket on the room again by then
   * (a reload or a reconnect keeps the room and its lobby). A second defer of the same user restarts it.
   */
  defer(lobbyId: string, userId: string, leave: () => Promise<void>): void;
  /** Cancels every pending leave (shutdown: Redis keeps the room for the next process). */
  close(): void;
};

const log = (msg: string, fields: Record<string, unknown>) =>
  console.log(JSON.stringify({ level: "info", msg, ...fields }));

export function createLastLeave({
  registry,
  scheduler,
  sockets,
  graceMs = LAST_LEAVE_GRACE_MS,
}: {
  registry: Pick<RoomRegistry, "room" | "withRoom">;
  scheduler: Scheduler;
  /** Open sockets of the user on the room in this process (`presence.sockets`). */
  sockets: (lobbyId: string, userId: string) => number;
  graceMs?: number;
}): LastLeave {
  const timers = new Map<string, TimerHandle>();
  const keyOf = (lobbyId: string, userId: string) => `${lobbyId}\n${userId}`;

  return {
    closes: (lobbyId, userId) =>
      registry.withRoom(lobbyId, async () => {
        const room = await registry.room(lobbyId);
        if (room?.phase !== "waiting") return false;
        const humans = room.seated.filter((desk) => !desk.isBot);
        return humans.length === 1 && humans[0]!.userId === userId;
      }),

    hostWithOthers: (lobbyId, userId) =>
      registry.withRoom(lobbyId, async () => {
        const room = await registry.room(lobbyId);
        if (room?.phase !== "waiting" && room?.phase !== "ended") return false;
        if (room.hostUserId !== userId) return false;
        // The last human's leave closes the room (`closes`) or keeps it (#143): nobody to promote.
        return room.seated.some((desk) => !desk.isBot && desk.userId !== userId);
      }),

    defer(lobbyId, userId, leave) {
      const key = keyOf(lobbyId, userId);
      const previous = timers.get(key);
      if (previous) scheduler.clear(previous);
      timers.set(
        key,
        scheduler.setTimeout(() => {
          timers.delete(key);
          // Back within the grace (a reload): the room and its lobby stay open.
          if (sockets(lobbyId, userId) > 0) return;
          leave().catch((err: unknown) =>
            log("last leave failed", { lobby: lobbyId, err: String(err) }),
          );
        }, graceMs),
      );
    },

    close() {
      for (const timer of timers.values()) scheduler.clear(timer);
      timers.clear();
    },
  };
}
