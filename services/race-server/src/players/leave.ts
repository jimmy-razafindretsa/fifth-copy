import type { Member, RaceSettings } from "@fifth-copy/protocol";
import type { NewHost, RoomRegistry } from "../rooms/registry";
import type { Presence } from "./presence";

/** What a member's leave touches; the socket server and the end of a race share it (#658). */
export type LeaveDeps = {
  registry: Pick<RoomRegistry, "leave" | "room" | "withRoom">;
  presence: Pick<Presence, "left" | "sockets" | "dropped">;
  onRoomClosed: (lobbyId: string) => void;
  /**
   * The room is gone for good (last human left, keys deleted, #734): the web is told to close the
   * `Lobby` row through the outbox. Fire and forget: never awaited, so a web outage never blocks
   * the leave. Not called for a kept ended room ("Race again" may still reopen it).
   */
  onLobbyClosed: (lobbyId: string) => void;
  /** Sends the room's new roster to its members and spectators. */
  announce: (lobbyId: string, members: Member[]) => void;
  /** Sends the room's settings after a leave turned `hostWatches` off (#876), before the roster. */
  announceSettings: (lobbyId: string, settings: RaceSettings) => void;
  /**
   * The leave passed the host role on (#137): `event new-host { desk }` to the room and the web's
   * `Lobby.hostUserId` through the outbox. Called after the roster went out; never awaited.
   */
  onNewHost: (lobbyId: string, host: NewHost) => void;
  /**
   * The watching host kept for the race (#876) leaves after the race end through the last-leave
   * grace (`lastLeave.defer`: a reload of the Dawn report keeps the role), as its disconnect would.
   * Absent: it leaves at once.
   */
  deferLeave?: (lobbyId: string, userId: string, leave: () => Promise<void>) => void;
};

/**
 * Removes a member: the last human closes the room, otherwise the room gets the new roster (and,
 * when the host left, its new host, #137: the same path serves a leave, a removal and `releaseDropped`). The
 * last human leaving an ended room (`kept`, #143) leaves its keys for "Race again" but frees the
 * room in this process as a close does (#658: nothing of the race outlives its last human here).
 */
export async function leaveRoom(
  deps: LeaveDeps,
  lobbyId: string,
  userId: string,
): Promise<{ members: Member[]; closed: boolean; kept: boolean }> {
  const { members, closed, kept, newHost, settings } = await deps.registry.leave(lobbyId, userId);
  if (closed || kept) deps.onRoomClosed(lobbyId);
  if (closed) deps.onLobbyClosed(lobbyId);
  else await deps.presence.left(lobbyId, userId);
  if (settings) deps.announceSettings(lobbyId, settings);
  if (!closed) deps.announce(lobbyId, members);
  if (newHost) deps.onNewHost(lobbyId, newHost);
  return { members, closed, kept };
}

/**
 * Once a race has ended (#658): a member seated through a socket whose sockets all closed during
 * the countdown or the race was kept for it (line cut, or past typing, `presence.socketClosed`).
 * Nothing holds that seat any more, so it leaves as a disconnect in `waiting` or `ended` would;
 * otherwise the room is never released in this process; the last one keeps an ended room (#143).
 */
export async function releaseDropped(deps: LeaveDeps, lobbyId: string): Promise<void> {
  const room = await deps.registry.withRoom(lobbyId, () => deps.registry.room(lobbyId));
  if (room?.phase !== "ended") return;
  const members = new Set(room.seated.map(({ userId }) => userId));
  const watcher = room.settings.hostWatches ? room.hostUserId : null;
  for (const userId of deps.presence.dropped(lobbyId)) {
    // A socket that reopened since the end keeps its seat (or its watch).
    if (deps.presence.sockets(lobbyId, userId) > 0) continue;
    if (userId === watcher) {
      const leave = async () => void (await leaveRoom(deps, lobbyId, userId));
      if (deps.deferLeave) deps.deferLeave(lobbyId, userId, leave);
      else await leave();
      continue;
    }
    if (!members.has(userId)) continue;
    const { closed, kept } = await leaveRoom(deps, lobbyId, userId);
    if (closed || kept) return;
  }
}
