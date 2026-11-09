import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { isClean } from "@/features/texts";
import {
  RECOVERY_CODE_WORDS,
  canonicalRecoveryCode,
  generateRecoveryCode,
  normalizeRecoveryWord,
} from "./generate";
import { RECOVERY_WORDS } from "./wordlist";

// #46 C1: 10 words from a 2048-word bilingual list with crypto.getRandomValues (>= 110 bits), and the
// order, case and accent insensitive canonical form that is hashed.

describe("recovery word list (#46 C1)", () => {
  it("has 2048 words (11 bits each), unique once normalized, letters only, all clean", () => {
    expect(RECOVERY_WORDS).toHaveLength(2048);
    const normalized = RECOVERY_WORDS.map(normalizeRecoveryWord);
    expect(new Set(normalized).size).toBe(2048);
    for (const w of normalized) expect(w).toMatch(/^[a-z]{3,12}$/);
    expect(RECOVERY_WORDS.filter((w) => !isClean(w))).toEqual([]);
    expect(RECOVERY_CODE_WORDS * Math.log2(RECOVERY_WORDS.length)).toBeGreaterThanOrEqual(110);
  });

  it("is bilingual: English and French halves, the French with accents", () => {
    expect(RECOVERY_WORDS.slice(0, 1024)).toContain("acorn");
    expect(RECOVERY_WORDS.slice(1024)).toContain("écureuil");
  });
});

describe("generateRecoveryCode (#46 C1)", () => {
  it("draws 10 words through crypto.getRandomValues", () => {
    const spy = vi.spyOn(crypto, "getRandomValues");
    const code = generateRecoveryCode();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    expect(code).toHaveLength(10);
    for (const w of code) expect(RECOVERY_WORDS).toContain(w);
  });

  it("maps every 11-bit value to its word (uniform, no modulo bias)", () => {
    const code = generateRecoveryCode((buf) => buf.map((_, i) => 0xfffff800 + i * 205));
    expect(code).toEqual(Array.from({ length: 10 }, (_, i) => RECOVERY_WORDS[i * 205]));
  });

  it("differs between draws", () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateRecoveryCode().join(" ")));
    expect(codes.size).toBe(50);
  });
});

describe("canonicalRecoveryCode (#46 C3)", () => {
  const code = [
    "écureuil",
    "acorn",
    "lion",
    "bâton",
    "zebra",
    "cerise",
    "piano",
    "kayak",
    "hôtel",
    "abacus",
  ];

  it("ignores order, case, accents and separators", () => {
    const a = canonicalRecoveryCode(code);
    expect(a).not.toBeNull();
    expect(canonicalRecoveryCode([...code].reverse().join("  "))).toBe(a);
    expect(
      canonicalRecoveryCode("ECUREUIL Acorn, lion-baton zebra CERISE piano kayak hotel abacus"),
    ).toBe(a);
  });

  it("refuses anything but 10 words of the list", () => {
    expect(canonicalRecoveryCode(code.slice(0, 9))).toBeNull();
    expect(canonicalRecoveryCode([...code, "acorn"])).toBeNull();
    expect(canonicalRecoveryCode([...code.slice(0, 9), "notaword"])).toBeNull();
    expect(canonicalRecoveryCode("")).toBeNull();
  });
});

describe("plaintext never logged (#46 C1)", () => {
  it("no recovery source passes the code to the logger", () => {
    const dirs = ["src/features/identity/recovery", "src/features/identity/actions"];
    for (const dir of dirs) {
      for (const f of readdirSync(dir).filter((n) => /recovery.*\.ts$|generate\.ts$/.test(n))) {
        if (f.endsWith(".test.ts")) continue;
        const src = readFileSync(join(dir, f), "utf8");
        for (const call of src.match(/logger\.\w+\([^)]*\)/g) ?? []) {
          expect(call).not.toMatch(/code|words|plain/i);
        }
      }
    }
  });
});
