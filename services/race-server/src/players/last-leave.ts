import type { Scheduler, TimerHandle } from "../clock";
import type { RoomRegistry } from "../rooms/registry";

/**
 * How long the last human of a waiting room may be gone before the room closes (#734). A reload of
 * the lobby page drops the socket and opens a new one within a second or two; the room (and its
 * `Lobby` row, which the close marks CLOSED) must survive it. Not a race duration: never scaled by
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
   * Whether `userId` hosts an `ended` room (#137): opening the Dawn report closes every member's
   * socket, so while another human is seated the host's leave waits out the same grace and promotes
   * nobody if the host is back (Race again) or every member left with it (the room is then kept, #143).
   * Read in the room's queue.
   */
  hostOfEnded(lobbyId: string, userId: string): Promise<boolean>;
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

    hostOfEnded: (lobbyId, userId) =>
      registry.withRoom(lobbyId, async () => {
        const room = await registry.room(lobbyId);
        if (room?.phase !== "ended" || room.hostUserId !== userId) return false;
        // The last human's leave keeps the room (#143) and promotes nobody: no need to wait.
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
