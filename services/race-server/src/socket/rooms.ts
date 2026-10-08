// Socket.IO room names of a race room (ADR 0006 point 8, ARCHITECTURE 7.8). Leaf module: the
// socket edge, the spectator edge and the composition root all name rooms through it.

/** The room's seated sockets (players and host): they hold a desk. */
export const lobbyRoom = (lobbyId: string) => `lobby:${lobbyId}`;
/** The sockets of one desk (a user's tabs): per-desk events such as `overtake` (#173). */
export const deskRoom = (lobbyId: string, desk: number) => `lobby:${lobbyId}:desk:${desk}`;
/** The room's read-only spectator sockets (#187): no desk, never in the registry. */
export const spectatorRoom = (lobbyId: string) => `spectator:${lobbyId}`;
/** Everyone watching a room: target of every room-wide broadcast (Socket.IO dedupes a socket). */
export const audience = (lobbyId: string) => [lobbyRoom(lobbyId), spectatorRoom(lobbyId)];
