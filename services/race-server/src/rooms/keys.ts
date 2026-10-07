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

/** Lifetime of a race's pending results (#189): retried for up to a day, then dropped (ADR 0008). */
export const OUTBOX_TTL_S = 24 * 3600;

/**
 * List: the JSON entries still to send for an ended race, one results chunk each (#189,
 * `persist/outbox.ts`); an entry leaves on acknowledgement. TTL `OUTBOX_TTL_S` from the enqueue.
 */
export const outboxKey = (raceId: string) => `outbox:${raceId}`;

/** Set: race ids with a pending outbox, re-sent on boot. TTL `OUTBOX_TTL_S`, refreshed per enqueue. */
export const OUTBOXES_KEY = "outboxes";

/**
 * String: JSON `{ lobbyId, userId, desk }` of a resume key (#178, ARCHITECTURE 7.4), `key` = 32
 * random bytes hex. TTL `ROOM_TTL_S` while its user is connected, `GRACE_MS` once the desk is
 * line-cut; deleted at grace expiry, at the race end of a line-cut desk, on leave and with the room.
 * Never a credential: the handshake reads it only after the race token verified (ADR 0009).
 */
export const resumeKey = (key: string) => `resume:${key}`;

/** Hash: `userId` -> its resume key, so every `welcome` of a user returns the same one. Room TTL. */
export const resumeIndexKey = (lobbyId: string) => `room:${lobbyId}:resume`;
