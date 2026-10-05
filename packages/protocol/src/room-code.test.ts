import { describe, expect, it } from "vitest";
import { formatRoomCode, parseRoomCode, ROOM_CODE_RE, roomCodeSchema } from "./index";

describe("room code", () => {
  it.each([
    ["KGB-4821", true],
    ["ABC-0000", true],
    ["KOB-4821", false],
    ["KIB-4821", false],
    ["kgb-4821", false],
    ["KGB4821", false],
    ["KGB-482", false],
    ["KGB-48211", false],
  ])("ROOM_CODE_RE / roomCodeSchema: %s -> %s", (code, ok) => {
    expect(ROOM_CODE_RE.test(code)).toBe(ok);
    expect(roomCodeSchema.safeParse(code).success).toBe(ok);
  });

  it.each([
    ["kgb4821x", "KGB-4821"],
    ["kg", "KG"],
    ["", ""],
    ["kgb", "KGB"],
    ["kgb4", "KGB-4"],
    ["k-g b!4821", "KGB-4821"],
    ["KGB-48219999", "KGB-4821"],
    ["12kgb", "KGB"],
  ])("formatRoomCode(%j) is %j", (raw, expected) => {
    expect(formatRoomCode(raw)).toBe(expected);
  });

  it.each([
    ["kgb-4821", "KGB-4821"],
    ["KGB4821", "KGB-4821"],
    [" kgb 4821 ", "KGB-4821"],
    ["KOB-4821", null],
    ["KGB-482", null],
    ["", null],
  ])("parseRoomCode(%j) is %j", (raw, expected) => {
    expect(parseRoomCode(raw)).toBe(expected);
  });
});
