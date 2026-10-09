import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as race from "@/features/race";
import { typedViewFixtures } from "../view/typed-view";
import { TelexStrip } from "./telex-strip";
import { TypedSheet } from "./typed-sheet";
import { TypewriterKeyboard } from "./typewriter-keyboard";

// Contract of #558 C8: the typing surface is presentational. It renders a TypedView and imports neither
// the socket client nor the engine or the protocol (ADR 0007, 0013); other code reaches it only through
// the race feature's index.ts (ADR 0001; dependency-cruiser enforces the cross-feature half).
const root = process.cwd();
const FILES = [
  "src/features/race/view/typed-view.ts",
  "src/features/race/components/typing-chars.tsx",
  "src/features/race/components/telex-strip.tsx",
  "src/features/race/components/typed-sheet.tsx",
  "src/features/race/components/typewriter-keyboard.tsx",
];

/** Every module specifier of a source file (static imports, re-exports, dynamic imports). */
function specifiers(source: string): string[] {
  return [
    ...source.matchAll(/(?:import|export)\s[^"';]*?from\s*["']([^"']+)["']/g),
    ...source.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g),
    ...source.matchAll(/^\s*import\s*["']([^"']+)["']/gm),
  ].map((m) => m[1]!);
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sources(full);
    return /\.(ts|tsx)$/.test(e.name) ? [full] : [];
  });
}

describe("typing surface imports (#558 C8)", () => {
  for (const file of FILES) {
    it(`${path.basename(file)} imports no socket client, engine or protocol`, () => {
      const specs = specifiers(readFileSync(path.join(root, file), "utf8"));
      for (const s of specs) {
        expect(s, file).not.toMatch(/(^|\/)client(\/|$)/);
        expect(s, file).not.toMatch(/^@fifth-copy\/(engine|protocol)/);
        expect(s, file).not.toMatch(/^socket\.io/);
      }
    });
  }

  it("exports the three components and the view model through the race index", () => {
    expect(race.TelexStrip).toBe(TelexStrip);
    expect(race.TypedSheet).toBe(TypedSheet);
    expect(race.TypewriterKeyboard).toBe(TypewriterKeyboard);
    expect(race.typedViewFixtures).toBe(typedViewFixtures);
    const index = readFileSync(path.join(root, "src/features/race/index.ts"), "utf8");
    expect(index).toMatch(/export type \{[^}]*\bTypedView\b[^}]*\} from "\.\/view\/typed-view"/);
  });

  it("no module outside the race feature reaches into its components or view", () => {
    const deep =
      /["']@\/features\/race\/(components|view)\b|["'][./]+features\/race\/(components|view)\b/;
    const hits = sources(path.join(root, "src"))
      .filter((f) => !f.startsWith(path.join(root, "src/features/race/")))
      .filter((f) => deep.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(root, f));
    expect(hits).toEqual([]);
  });
});
