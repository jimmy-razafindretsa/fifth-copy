import type { RoomCode } from "@fifth-copy/protocol";

/**
 * Client copy of the `@fifth-copy/protocol` room-code helpers for the join form. The protocol's
 * module builds `roomCodeSchema` with zod classic, which would put ~91 kB gzip into the first load
 * of `/` and `/lobby/[code]` (#626). Kept identical by room-code-input.test.ts (parity against the
 * protocol); the server action still re-parses with the protocol's `parseRoomCode`.
 */
const ROOM_CODE_RE = /^[A-HJ-NP-Z]{3}-[0-9]{4}$/;

/** Input mask: uppercases, letters then digits only, dash after 3 letters, max 8 chars. */
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
  const code = formatRoomCode(raw);
  return ROOM_CODE_RE.test(code) ? (code as RoomCode) : null;
}
