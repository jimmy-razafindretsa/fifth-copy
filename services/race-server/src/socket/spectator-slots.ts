// Per-room spectator admission (#616, ADR 0006 point 8, ARCHITECTURE 7.9). Leaf module: the
// handshake middleware reserves a slot, the socket's close releases it. Process-local, like
// presence's socket counts: multi-node counting (Redis adapter) is out of scope.

/** Server policy, not a wire bound: the 100-client fan-out budget of one room (ARCHITECTURE 7.9). */
export const MAX_SPECTATORS_PER_ROOM = 100;

export type SpectatorSlots = {
  /** Takes one slot of the room; false when the room already holds `max` spectators. */
  reserve(lobbyId: string): boolean;
  /** Gives one slot back; never below zero. The caller releases each reservation once. */
  release(lobbyId: string): void;
  /** Spectator slots held in the room. */
  count(lobbyId: string): number;
  /** Rooms with at least one slot held (an empty room is forgotten). */
  rooms(): number;
};

export function createSpectatorSlots(max: number = MAX_SPECTATORS_PER_ROOM): SpectatorSlots {
  const held = new Map<string, number>();
  return {
    reserve(lobbyId) {
      const n = held.get(lobbyId) ?? 0;
      if (n >= max) return false;
      held.set(lobbyId, n + 1);
      return true;
    },
    release(lobbyId) {
      const n = held.get(lobbyId) ?? 0;
      if (n <= 1) held.delete(lobbyId);
      else held.set(lobbyId, n - 1);
    },
    count: (lobbyId) => held.get(lobbyId) ?? 0,
    rooms: () => held.size,
  };
}
