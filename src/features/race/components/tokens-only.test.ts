import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Contract of #558 C8: the typing surface takes every colour, face and duration from the tokens, and a
// machine skin paints only through the machine-* roles (plus the tape and the error red).
// (scripts/check-colours.ts already rejects raw hex and --brand-* under src/; this adds the declared-token
// and duration rules for these modules.)
const dir = path.join(process.cwd(), "src/features/race/components");
const read = (file: string) => readFileSync(path.join(dir, file), "utf8");
const tokens = readFileSync(path.join(process.cwd(), "docs/design/tokens.css"), "utf8");
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Every file under the components folder (relative paths), tests and fixtures aside. */
function files(sub = ""): string[] {
  return readdirSync(path.join(dir, sub), { withFileTypes: true }).flatMap((e) => {
    const rel = sub ? `${sub}/${e.name}` : e.name;
    if (e.isDirectory()) return e.name === "__fixtures__" ? [] : files(rel);
    return /\.test\.tsx?$/.test(e.name) ? [] : [rel];
  });
}

const MODULES = files().filter((f) => f.endsWith(".module.css"));
const COMPONENTS = files().filter((f) => /\.tsx?$/.test(f));
const SKIN_MODULES = MODULES.filter((f) => f.startsWith("machine/skins/"));
// comments carry card numbers such as #558, which read like hex
const tsx = COMPONENTS.map((f) => strip(read(f)).replace(/\/\/[^\n]*/g, "")).join("\n");

describe("typing surface modules use tokens only (#558 C8)", () => {
  it("covers the strip, the sheet and every machine skin", () => {
    for (const f of [
      "typing.module.css",
      "telex-strip.module.css",
      "typed-sheet.module.css",
      "machine/skins/teleprinter.module.css",
    ]) {
      expect(MODULES, f).toContain(f);
    }
    expect(COMPONENTS).toContain("machine/typing-machine.tsx");
    expect(COMPONENTS).toContain("machine/skins/teleprinter.tsx");
  });

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

    it(`${file}: the only literal durations are the bible 8 keyframe seconds (1.05s, 0.18s, 1.3s)`, () => {
      const durations = [...css.matchAll(/(?<![\w.-])(\d*\.?\d+)(m?s)\b/g)].map((m) => m[0]);
      // fcCaret 1.05s, fcPop 0.18s (#558); lkPulse 1.3s, inside bible 8's 1.2-1.4s (#560 notice rows)
      for (const d of durations) expect(["1.05s", "0.18s", "1.3s"], d).toContain(d);
      expect(css).not.toMatch(/transition(-duration)?\s*:[^;]*\d/);
    });
  }

  for (const file of SKIN_MODULES) {
    it(`${file}: a skin paints only var(--color-machine-*), the tape and the error red, through --_`, () => {
      const css = strip(read(file));
      const used = [...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]!);
      for (const name of used) {
        expect(name).toMatch(/^--(_[\w-]+|color-(machine-[\w-]+|tape|typing-error))$/);
      }
      // the roles are mapped to private properties once, on the skin root; parts read only --_
      const rules = css.split("}").filter((r) => /var\(--color-/.test(r));
      expect(rules, "one mapping block").toHaveLength(1);
      expect(css).not.toMatch(/color-mix\(/);
    });
  }

  it("the components set no colour, face or duration inline", () => {
    expect(tsx).not.toMatch(/#[0-9a-fA-F]{3,8}\b(?!-)/);
    expect(tsx).not.toMatch(/\b(color|background|fill|stroke|fontFamily|animation)\s*:/);
    expect(tsx).not.toContain("--brand-");
  });
});

// Contract of #560 C8: the seat view HUD dockets (nixie counters, race card, Sabotage tray, Abandon, notices)
// take every colour, face and duration from the tokens too (the per-module rules above run on them), and
// the glow lives only in the nixie tubes (bible 0, 6 device glow).
const HUD_MODULES = [
  "hud-docket.module.css",
  "nixie-counters.module.css",
  "race-card.module.css",
  "sabotage-tray.module.css",
  "abandon-control.module.css",
  "race-notice.module.css",
];
const HUD_COMPONENTS = [
  "nixie-counters.tsx",
  "race-card.tsx",
  "sabotage-tray.tsx",
  "abandon-control.tsx",
  "race-notice.tsx",
];

describe("seat view HUD modules use tokens only (#560 C8)", () => {
  it("covers the five HUD components and their shared docket", () => {
    for (const f of HUD_MODULES) expect(MODULES, f).toContain(f);
    for (const f of HUD_COMPONENTS) expect(COMPONENTS, f).toContain(f);
  });

  it("glow (a blurred shadow or a device glow role) appears only in the nixie tubes", () => {
    for (const file of HUD_MODULES) {
      const css = strip(read(file));
      const blurred = [...css.matchAll(/(?:text|box)-shadow\s*:\s*([^;]+);/g)]
        .map((m) => m[1]!)
        .filter((v) => /\b0 0 [1-9]\d*px\b/.test(v) || /device-nixie-glow/.test(v));
      if (file === "nixie-counters.module.css") expect(blurred.length, file).toBeGreaterThan(0);
      else expect(blurred, file).toEqual([]);
      if (file !== "nixie-counters.module.css") expect(css, file).not.toContain("--color-device-");
    }
  });

  it("type comes from the roles: VT323 only through type-device, in the nixie counters", () => {
    const others = [...HUD_MODULES, ...HUD_COMPONENTS].filter((f) => !f.startsWith("nixie-"));
    for (const file of others) expect(strip(read(file)), file).not.toContain("type-device");
    expect(read("nixie-counters.tsx")).toMatch(/["\s]type-device[\s"]/);
  });
});
