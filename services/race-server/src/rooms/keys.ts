/** Redis layout of a room (ADR 0008). Every key carries ROOM_TTL_S, refreshed on activity. */
export const ROOM_TTL_S = 3600;

/**
 * Hash: `code`, `hostUserId`, `phase` (protocol `Phase`), `openedAt`, `settings` (JSON
 * `RaceSettings`, parsed on read); from `host:start` on (#166): `raceId`, `t0` and `endAt` (server ms
 * epoch of GO and of the timed end), `race` (JSON `RaceInfo`) and `desks` (JSON desks at start).
 */
export const roomKey = (lobbyId: string) => `room:${lobbyId}`;

/** Hash: `userId` -> JSON `{ desk, name }`. */
export const membersKey = (lobbyId: string) => `room:${lobbyId}:members`;
