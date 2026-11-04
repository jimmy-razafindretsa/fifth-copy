import { describe, expect, it } from "vitest";
import {
  RESET_CODE_ALPHABET,
  RESET_CODE_LENGTH,
  formatResetCode,
  generateResetCode,
  normalizeResetCode,
} from "./code";

// #788 C2: the teacher reset code. 8 Crockford base32 characters (40 bits) from node:crypto,
// displayed XXXX-XXXX, normalized the same way by the redeem (R2) and the host UI (R3).
const CROCKFORD = /^[0-9A-HJKMNP-TV-Z]{8}$/;

describe("reset code (C2)", () => {
  it("uses the 32-character Crockford alphabet: digits and letters without I, L, O, U", () => {
    expect(RESET_CODE_ALPHABET).toBe("0123456789ABCDEFGHJKMNPQRSTVWXYZ");
    expect(new Set(RESET_CODE_ALPHABET).size).toBe(32);
    expect(RESET_CODE_LENGTH).toBe(8);
  });

  it("generates 8 Crockford characters", () => {
    for (let i = 0; i < 200; i++) expect(generateResetCode()).toMatch(CROCKFORD);
  });

  it("10 000 generated codes are all distinct and every character of the alphabet appears", () => {
    const codes = Array.from({ length: 10_000 }, generateResetCode);
    expect(new Set(codes).size).toBe(10_000);
    const seen = new Set(codes.join(""));
    expect([...seen].sort().join("")).toBe(RESET_CODE_ALPHABET);
  });

  it("formats as XXXX-XXXX", () => {
    expect(formatResetCode("ABCDEFGH")).toBe("ABCD-EFGH");
    expect(formatResetCode(generateResetCode())).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  });

  it("normalizes case, spaces and hyphens alike", () => {
    const forms = ["abcd-efgh", "ABCD EFGH", "abcdefgh", " AbCd - eFgH "];
    for (const f of forms) expect(normalizeResetCode(f)).toBe("ABCDEFGH");
    expect(normalizeResetCode(formatResetCode("0123ABCD"))).toBe("0123ABCD");
  });
});
