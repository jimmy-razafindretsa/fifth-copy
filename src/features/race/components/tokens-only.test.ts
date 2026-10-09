import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Contract of #558 C6: the typing surface takes every colour, face and duration from the tokens.
// (scripts/check-colours.ts already rejects raw hex and --brand-* under src/; this adds the declared-token
// and duration rules for these modules.)
const dir = path.join(process.cwd(), "src/features/race/components");
const read = (file: string) => readFileSync(path.join(dir, file), "utf8");
const tokens = readFileSync(path.join(process.cwd(), "docs/design/tokens.css"), "utf8");
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

const MODULES = [
  "typing.module.css",
  "telex-strip.module.css",
  "typed-sheet.module.css",
  "typewriter-keyboard.module.css",
];
const COMPONENTS = [
  "typing-chars.tsx",
  "telex-strip.tsx",
  "typed-sheet.tsx",
  "typewriter-keyboard.tsx",
];
// comments carry card numbers such as #558, which read like hex
const tsx = COMPONENTS.map((f) => strip(read(f)).replace(/\/\/[^\n]*/g, "")).join("\n");

describe("typing surface modules use tokens only (#558 C6)", () => {
  for (const file of MODULES) {
    const css = strip(read(file));

    it(`${file}: no literal colour`, () => {
      expect(css, "hex").not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(css, "functional colour").not.toMatch(/\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/);
      expect(css, "named colour").not.toMatch(
        /:\s*[^;{}]*\b(black|white|red|green|grey|gray|silver|ivory|cream|beige)\b/,
      );
      expect(css, "brand value").not.toContain("--brand-");
    });

    it(`${file}: no face of its own (type roles through @apply only)`, () => {
      expect(css).not.toMatch(/^\s*font(-family)?\s*:/m);
      expect(css).not.toMatch(/var\(--font-/);
    });

    it(`${file}: every var() is a token of tokens.css or a private --_ property declared here`, () => {
      const used = [...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]!);
      for (const name of new Set(used)) {
        if (name.startsWith("--_")) {
          expect(`${css}\n${tsx}`, name).toMatch(new RegExp(`["\\s;{]${name}["\\s]*:`));
        } else {
          expect(tokens, name).toMatch(new RegExp(`${name}\\s*:`));
        }
      }
    });

    it(`${file}: the only literal durations are the bible 8 keyframe seconds (1.05s, 0.18s)`, () => {
      const durations = [...css.matchAll(/(?<![\w.-])(\d*\.?\d+)(m?s)\b/g)].map((m) => m[0]);
      for (const d of durations) expect(["1.05s", "0.18s"], d).toContain(d);
      expect(css).not.toMatch(/transition(-duration)?\s*:[^;]*\d/);
    });
  }

  it("the components set no colour, face or duration inline", () => {
    expect(tsx).not.toMatch(/#[0-9a-fA-F]{3,8}\b(?!-)/);
    expect(tsx).not.toMatch(/\b(color|background|fill|stroke|fontFamily|animation)\s*:/);
    expect(tsx).not.toContain("--brand-");
  });
});
