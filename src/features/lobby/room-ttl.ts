/**
 * The race server's `ROOM_TTL_S` (2 h, `services/race-server/src/rooms/keys.ts`), in ms: how long a
 * room's Redis keys outlive their last write. Mirrored here because `src/` never imports `services/`
 * (ADR 0005). The open-rooms listing (#806) and the expiry job (#734) read it.
 */
export const ROOM_TTL_MS = 2 * 3600 * 1000;
