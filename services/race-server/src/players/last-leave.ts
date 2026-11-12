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
   * Only a disconnect asks; an explicit leave (`leaveRoom`) promotes at once. A watching host (#876)
   * waits it out in every phase, others in the room or not. Read in the room's queue.
   */
  hostWithOthers(lobbyId: string, userId: string): Promise<boolean>;
  /**
   * Runs `leave` after `LAST_LEAVE_GRACE_MS` unless the user has a socket on the room again by then
   * (a reload or a reconnect keeps the room and its lobby). A second defer of the same user restarts it.
   */
  defer(lobbyId: string, userId: string, leave: () => Promise<void>): void;
  /**
   * Whether a deferred leave of the room is still pending for a user with no socket on it (#890):
   * an armed auto-start waits it out, so a host's reload never finds a race started without them.
   * A user already back within the grace no longer holds the room.
   */
  pending(lobbyId: string): boolean;
  /**
   * Cancels every pending leave (shutdown: Redis keeps the room for the next process); a `defer`
   * after it arms nothing (#886: a disconnect whose checks were still reading Redis at shutdown).
   */
  close(): void;
};

const log = (msg: string, fields: Record<string, unknown>) =>
  console.log(JSON.stringify({ level: "info", msg, ...fields }));

export function createLastLeave({
  registry,
  scheduler,
  sockets,
  graceMs = LAST_LEAVE_GRACE_MS,
  onSettled = () => {},
}: {
  registry: Pick<RoomRegistry, "room" | "withRoom">;
  scheduler: Scheduler;
  /** Open sockets of the user on the room in this process (`presence.sockets`). */
  sockets: (lobbyId: string, userId: string) => number;
  graceMs?: number;
  /**
   * A deferred leave resolved (the user came back, or the leave ran, failed included): the room's
   * auto-start held by `pending` is reviewed again (#890). Never after `close()`.
   */
  onSettled?: (lobbyId: string) => void;
}): LastLeave {
  const timers = new Map<string, { lobbyId: string; userId: string; handle: TimerHandle }>();
  const keyOf = (lobbyId: string, userId: string) => `${lobbyId}\n${userId}`;
  let shut = false;

  return {
    closes: (lobbyId, userId) =>
      registry.withRoom(lobbyId, async () => {
        const room = await registry.room(lobbyId);
        // A watching host (#876) holds the room open: a seated human's leave never closes it.
        if (room?.phase !== "waiting" || room.settings.hostWatches) return false;
        const humans = room.seated.filter((desk) => !desk.isBot);
        return humans.length === 1 && humans[0]!.userId === userId;
      }),

    hostWithOthers: (lobbyId, userId) =>
      registry.withRoom(lobbyId, async () => {
        const room = await registry.room(lobbyId);
        if (room?.hostUserId !== userId) return false;
        // The watching host (#876), in any phase: a reload of its lobby page, seat view or Dawn report
        // passes the role on (or closes the room) only if it is still away after the same grace.
        if (room.settings.hostWatches) return true;
        if (room.phase !== "waiting" && room.phase !== "ended") return false;
        // The last human's leave closes the room (`closes`) or keeps it (#143): nobody to promote.
        return room.seated.some((desk) => !desk.isBot && desk.userId !== userId);
      }),

    defer(lobbyId, userId, leave) {
      if (shut) return;
      const key = keyOf(lobbyId, userId);
      const previous = timers.get(key);
      if (previous) scheduler.clear(previous.handle);
      const settled = () => {
        if (!shut) onSettled(lobbyId);
      };
      const handle = scheduler.setTimeout(() => {
        timers.delete(key);
        // Back within the grace (a reload): the room and its lobby stay open.
        if (sockets(lobbyId, userId) > 0) return settled();
        leave()
          .catch((err: unknown) => log("last leave failed", { lobby: lobbyId, err: String(err) }))
          .finally(settled);
      }, graceMs);
      timers.set(key, { lobbyId, userId, handle });
    },

    pending: (lobbyId) =>
      [...timers.values()].some(
        (timer) => timer.lobbyId === lobbyId && sockets(lobbyId, timer.userId) === 0,
      ),

    close() {
      shut = true;
      for (const { handle } of timers.values()) scheduler.clear(handle);
      timers.clear();
    },
  };
}
