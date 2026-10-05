import { ROOM_CODE_RE, type RoomCode } from "@fifth-copy/protocol";

// A float in [0, 1), like the engine's Rng; redeclared because lobby does not import the engine.
export type Rng = () => number;

// Letters without I and O (ROOM_CODE_RE), so a code read aloud is never ambiguous.
export const ROOM_CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
export const ROOM_CODE_DRAWS = 5;

function letter(rng: Rng): string {
  return ROOM_CODE_LETTERS[Math.floor(rng() * ROOM_CODE_LETTERS.length)]!;
}

// Pure: `XXX-NNNN`, e.g. "KGB-4821" (4 zero-padded digits).
export function generateRoomCode(rng: Rng): RoomCode {
  const digits = String(Math.floor(rng() * 10_000)).padStart(4, "0");
  const code = `${letter(rng)}${letter(rng)}${letter(rng)}-${digits}`;
  if (!ROOM_CODE_RE.test(code)) throw new Error("Room code generator out of range");
  return code as RoomCode;
}

// Draws codes until `tryCreate` accepts one (non-null; null = code already taken).
export async function withUniqueRoomCode<T>(
  rng: Rng,
  tryCreate: (code: RoomCode) => Promise<T | null>,
): Promise<T> {
  for (let i = 0; i < ROOM_CODE_DRAWS; i++) {
    const created = await tryCreate(generateRoomCode(rng));
    if (created !== null) return created;
  }
  throw new Error("No free room code");
}
