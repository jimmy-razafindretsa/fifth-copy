import { describe, expect, it } from "vitest";
import * as protocol from "@fifth-copy/protocol";
import { formatRoomCode, parseRoomCode } from "./room-code-input";

// #626: the join form's zod-free copy of the protocol room-code helpers behaves exactly like them.
const samples = [
  "",
  "k",
  "kg",
  "kgb",
  "kgb4",
  "kgb4821x",
  "KGB-4821",
  "kgb-4821",
  "KGB4821",
  " kgb 4821 ",
  "k-g b!4821",
  "KGB-48219999",
  "12kgb",
  "KOB-4821",
  "KIB-4821",
  "KGB-482",
  "ÀBC-1234",
  "abc-0000",
  "zzz9999",
];

function randomInput(seed: number): string {
  const alphabet = "abcioxyzABCIOXYZ0123456789- !é";
  let s = seed;
  let out = "";
  const len = seed % 12;
  for (let i = 0; i < len; i++) {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    out += alphabet[s % alphabet.length];
  }
  return out;
}

describe("room-code-input", () => {
  const inputs = [...samples, ...Array.from({ length: 500 }, (_, i) => randomInput(i + 1))];

  it.each(inputs)("formatRoomCode(%j) matches @fifth-copy/protocol", (raw) => {
    expect(formatRoomCode(raw)).toBe(protocol.formatRoomCode(raw));
  });

  it.each(inputs)("parseRoomCode(%j) matches @fifth-copy/protocol", (raw) => {
    expect(parseRoomCode(raw)).toBe(protocol.parseRoomCode(raw));
  });

  it("parses a lower-case code with no dash", () => {
    expect(parseRoomCode("kgb4821")).toBe("KGB-4821");
    expect(parseRoomCode("KOB-4821")).toBeNull();
  });
});
