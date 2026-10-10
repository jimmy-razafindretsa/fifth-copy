import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as race from "@/features/race";
import { typedViewFixtures } from "../view/typed-view";
import { machineSkinIds } from "./machine/skin";
import { TypingMachine } from "./machine/typing-machine";
import { TelexStrip } from "./telex-strip";
import { TypedSheet } from "./typed-sheet";

// Contract of #558 C10: the typing surface is presentational. It renders a TypedView and the machine
// props and imports neither the socket client nor the engine or the protocol (ADR 0007, 0013); other code
// reaches it only through the race feature's index.ts (ADR 0001; dependency-cruiser enforces the
// cross-feature half), and a machine skin only through the skin registry.
const root = process.cwd();
const components = path.join(root, "src/features/race/components");

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

const isTest = (file: string) => /\.test\.tsx?$/.test(file);
const FILES = [
  path.join(root, "src/features/race/view/typed-view.ts"),
  ...sources(components).filter((f) => !isTest(f)),
];

describe("typing surface imports (#558 C10)", () => {
  it("covers the strip, the sheet, the frame, the registry and every skin", () => {
    const rel = FILES.map((f) => path.relative(components, f));
    for (const f of [
      "typing-chars.tsx",
      "telex-strip.tsx",
      "typed-sheet.tsx",
      "machine/skin.ts",
      "machine/typing-machine.tsx",
      "machine/skins/index.ts",
      "machine/skins/teleprinter.tsx",
    ]) {
      expect(rel, f).toContain(f);
    }
  });

  for (const file of FILES) {
    it(`${path.relative(root, file)} imports no socket client, engine or protocol`, () => {
      for (const s of specifiers(readFileSync(file, "utf8"))) {
        expect(s, file).not.toMatch(/(^|\/)client(\/|$)/);
        expect(s, file).not.toMatch(/^@fifth-copy\/(engine|protocol)/);
        expect(s, file).not.toMatch(/^socket\.io/);
      }
    });
  }

  it("exports the components, the machine seam and the view model through the race index", () => {
    expect(race.TelexStrip).toBe(TelexStrip);
    expect(race.TypedSheet).toBe(TypedSheet);
    expect(race.TypingMachine).toBe(TypingMachine);
    expect(race.machineSkinIds).toBe(machineSkinIds);
    expect(race.typedViewFixtures).toBe(typedViewFixtures);
    const index = readFileSync(path.join(root, "src/features/race/index.ts"), "utf8");
    expect(index).toMatch(/export type \{[^}]*\bTypedView\b[^}]*\} from "\.\/view\/typed-view"/);
    expect(index).toMatch(/\btype MachineSkinId\b/);
    // the frame and the registry stay internal: the seam is TypingMachine and its skin prop
    expect(index).not.toMatch(/\bMachineFrame\b|\bmachineSkins\b/);
  });

  it("the desk typewriter is gone (no TypewriterKeyboard, no typewriter-keyboard module)", () => {
    expect("TypewriterKeyboard" in race).toBe(false);
    for (const ext of [".tsx", ".module.css", ".test.tsx"]) {
      expect(existsSync(path.join(components, `typewriter-keyboard${ext}`)), ext).toBe(false);
    }
  });

  it("a skin module is imported only by the skin registry (tests aside)", () => {
    const skins = path.join(components, "machine/skins");
    const ids = readdirSync(skins)
      .filter((f) => f.endsWith(".tsx") && !isTest(f))
      .map((f) => f.replace(/\.tsx$/, ""));
    expect(ids).toContain("teleprinter");
    const importer = new RegExp(`(^|/)skins/(${ids.join("|")})$|^\\./(${ids.join("|")})$`);
    const hits = sources(path.join(root, "src"))
      .filter((f) => !isTest(f))
      .filter((f) => specifiers(readFileSync(f, "utf8")).some((s) => importer.test(s)))
      .map((f) => path.relative(root, f));
    expect(hits).toEqual(["src/features/race/components/machine/skins/index.ts"]);
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
