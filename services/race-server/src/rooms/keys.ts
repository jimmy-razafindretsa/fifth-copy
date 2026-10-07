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

/**
 * Hash: desk number -> JSON `DeskState` without `trace` and `typed` (#173, #592): the live mirror of
 * each desk's engine counters, status and anomaly counts, written once per tick for the desks changed
 * since the previous one (`typed` replays from the trace). A mirror, never a recovery source (a
 * running room is voided on restart, ADR 0008).
 */
export const desksKey = (lobbyId: string) => `room:${lobbyId}:desks`;

/**
 * List: one JSON `Keystroke` per entry, in order (#592): the desk's trace, appended each tick with
 * only the keys accepted since the previous one. TTL set at each write (not refreshed by the room's
 * other writes); emptied by the first write of a new race and deleted with the room.
 */
export const traceKey = (lobbyId: string, desk: number) => `room:${lobbyId}:trace:${desk}`;
