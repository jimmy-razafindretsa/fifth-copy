import { z } from "zod";
import { ROOM_CODE_RE } from "./room-code-format";

export { ROOM_CODE_RE, formatRoomCode, parseRoomCode, type RoomCode } from "./room-code-format";

/** Wire schema for a room code (`ROOM_CODE_RE`); parses to `RoomCode`. Zod-free helpers: room-code-format.ts. */
export const roomCodeSchema = z.string().regex(ROOM_CODE_RE).brand<"RoomCode">();
