import type { RoomSocket } from "./socket";

/** How long a parked waiting-room socket waits for the seat view's own `welcome` (#214 C2). */
export const HANDOFF_MS = 10_000;

const parked = new Map<
  string,
  { socket: Pick<RoomSocket, "close">; timer: ReturnType<typeof setTimeout> }
>();

/**
 * The waiting room -> seat view handover (#214, ARCHITECTURE 7.4). During the countdown the race server
 * line-cuts a desk as soon as its user's last socket closes, and the seat view's socket only opens after
 * a token mint and a chunk load. So the waiting room parks its socket here (its listeners already
 * unbound) instead of closing it: the server answers `still-connected` while the user has a second
 * socket. `connectSeat` releases it after its own `welcome`; it closes by itself after `HANDOFF_MS`.
 * One per lobby: parking again closes the previous one. No React state, no storage.
 */
export function parkSocket(lobbyId: string, socket: Pick<RoomSocket, "close">): void {
  releaseParkedSocket(lobbyId);
  const timer = setTimeout(() => releaseParkedSocket(lobbyId), HANDOFF_MS);
  parked.set(lobbyId, { socket, timer });
}

/** Closes the socket parked for `lobbyId`, if any (called once the seat view is welcomed). */
export function releaseParkedSocket(lobbyId: string): void {
  const entry = parked.get(lobbyId);
  if (!entry) return;
  parked.delete(lobbyId);
  clearTimeout(entry.timer);
  entry.socket.close();
}
