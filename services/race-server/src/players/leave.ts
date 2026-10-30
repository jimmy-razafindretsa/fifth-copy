import type { Member } from "@fifth-copy/protocol";
import type { RoomRegistry } from "../rooms/registry";
import type { Presence } from "./presence";

/** What a member's leave touches; the socket server and the end of a race share it (#658). */
export type LeaveDeps = {
  registry: Pick<RoomRegistry, "leave" | "room" | "withRoom">;
  presence: Pick<Presence, "left" | "sockets" | "dropped">;
  onRoomClosed: (lobbyId: string) => void;
  /** Sends the room's new roster to its members and spectators. */
  announce: (lobbyId: string, members: Member[]) => void;
};

/** Removes a member: the last human closes the room, otherwise the room gets the new roster. */
export async function leaveRoom(
  deps: LeaveDeps,
  lobbyId: string,
  userId: string,
): Promise<{ members: Member[]; closed: boolean }> {
  const { members, closed } = await deps.registry.leave(lobbyId, userId);
  if (closed) deps.onRoomClosed(lobbyId);
  else {
    await deps.presence.left(lobbyId, userId);
    deps.announce(lobbyId, members);
  }
  return { members, closed };
}

/**
 * Once a race has ended (#658): a member seated through a socket whose sockets all closed during
 * the countdown or the race was kept for it (line cut, or past typing, `presence.socketClosed`).
 * Nothing holds that seat any more, so it leaves as a disconnect in `waiting` or `ended` would;
 * otherwise the room never closes and its in-process state is never released.
 */
export async function releaseDropped(deps: LeaveDeps, lobbyId: string): Promise<void> {
  const room = await deps.registry.withRoom(lobbyId, () => deps.registry.room(lobbyId));
  if (room?.phase !== "ended") return;
  const members = new Set(room.seated.map(({ userId }) => userId));
  for (const userId of deps.presence.dropped(lobbyId)) {
    // A socket that reopened since the end keeps its seat.
    if (!members.has(userId) || deps.presence.sockets(lobbyId, userId) > 0) continue;
    const { closed } = await leaveRoom(deps, lobbyId, userId);
    if (closed) return;
  }
}
