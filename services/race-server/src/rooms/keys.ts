/** Redis layout of a waiting room (ADR 0008). Every key carries ROOM_TTL_S, refreshed on activity. */
export const ROOM_TTL_S = 3600;

/** Hash: `code`, `hostUserId`, `phase`, `openedAt`, `settings` (JSON `RaceSettings`, parsed on read). */
export const roomKey = (lobbyId: string) => `room:${lobbyId}`;

/** Hash: `userId` -> JSON `{ desk, name }`. */
export const membersKey = (lobbyId: string) => `room:${lobbyId}:members`;
