import { z } from "zod";

/** Room code: 3 letters (no I or O), a dash, 4 digits. Example: `KGB-4821`. */
export const ROOM_CODE_RE = /^[A-HJ-NP-Z]{3}-[0-9]{4}$/;

export const roomCodeSchema = z.string().regex(ROOM_CODE_RE).brand<"RoomCode">();
export type RoomCode = z.infer<typeof roomCodeSchema>;

/**
 * Input mask for a partially typed code: uppercases, keeps letters then digits only, inserts the
 * dash after 3 letters, max 8 chars. `formatRoomCode("kgb4821x")` is `"KGB-4821"`.
 */
export function formatRoomCode(raw: string): string {
  const upper = raw.toUpperCase();
  let letters = "";
  let digits = "";
  for (const ch of upper) {
    if (letters.length < 3) {
      if (ch >= "A" && ch <= "Z") letters += ch;
    } else if (digits.length < 4 && ch >= "0" && ch <= "9") {
      digits += ch;
    }
  }
  return letters.length === 3 && digits.length > 0 ? `${letters}-${digits}` : letters;
}

/** Normalizes a full code (case, missing dash, spaces); `null` when it is not a valid room code. */
export function parseRoomCode(raw: string): RoomCode | null {
  const result = roomCodeSchema.safeParse(formatRoomCode(raw));
  return result.success ? result.data : null;
}
