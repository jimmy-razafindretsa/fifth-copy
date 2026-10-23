import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as race from "@/features/race";
import { hudLabelFixtures } from "../view/hud-labels";
import { raceCardViewFixtures } from "../view/race-card-view";
import { typedViewFixtures } from "../view/typed-view";
import { AbandonControl } from "./abandon-control";
import { machineSkinIds } from "./machine/skin";
import { TypingMachine } from "./machine/typing-machine";
import { NixieCounters } from "./nixie-counters";
import { RaceCard } from "./race-card";
import * as prediction from "../client/prediction";
import { RaceInput } from "./race-input";
import { RaceNotice } from "./race-notice";
import { SabotageTray } from "./sabotage-tray";
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
  // #560 C10: the HUD's view model and copy are data too
  path.join(root, "src/features/race/view/race-card-view.ts"),
  path.join(root, "src/features/race/view/hud-labels.ts"),
  // #220 C2: the machine's live props are a pure selector too
  path.join(root, "src/features/race/view/machine-props.ts"),
  ...sources(components).filter((f) => !isTest(f)),
];

/**
 * #220 C2: the one live leaf of the components, the machine wrapper, reads the race store through its
 * React binding (ADR 0013: the HTML overlays are driven by the store) and nothing else of the client.
 */
const STORE_READERS: Record<string, string> = {
  [path.join(components, "machine/typing-machine-live.tsx")]: "../../client/use-race-store",
};

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
      "machine/typing-machine-live.tsx",
      "../view/machine-props.ts",
    ]) {
      expect(rel, f).toContain(f);
    }
  });

  for (const file of FILES) {
    it(`${path.relative(root, file)} imports no socket client, engine or protocol`, () => {
      for (const s of specifiers(readFileSync(file, "utf8"))) {
        if (s === STORE_READERS[file]) continue;
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

  // Contract of #560 C10: the seat view HUD dockets are presentational too (ADR 0013: they take data,
  // never the socket; ADR 0007: ranks, progress and WPM arrive as props).
  it("#560 covers the five HUD components and their view model", () => {
    const rel = FILES.map((f) => path.relative(components, f));
    for (const f of [
      "nixie-counters.tsx",
      "race-card.tsx",
      "sabotage-tray.tsx",
      "abandon-control.tsx",
      "race-notice.tsx",
      "../view/race-card-view.ts",
      "../view/hud-labels.ts",
    ]) {
      expect(rel, f).toContain(f);
    }
  });

  it("#560 exports the HUD components, their view model and copy fixtures through the race index", () => {
    expect(race.NixieCounters).toBe(NixieCounters);
    expect(race.RaceCard).toBe(RaceCard);
    expect(race.SabotageTray).toBe(SabotageTray);
    expect(race.AbandonControl).toBe(AbandonControl);
    expect(race.RaceNotice).toBe(RaceNotice);
    expect(race.raceCardViewFixtures).toBe(raceCardViewFixtures);
    expect(race.hudLabelFixtures).toBe(hudLabelFixtures);
    const index = readFileSync(path.join(root, "src/features/race/index.ts"), "utf8");
    expect(index).toMatch(
      /export type \{[^}]*\bRaceCardView\b[^}]*\} from "\.\/view\/race-card-view"/,
    );
    expect(index).toMatch(/export type \{[^}]*\bHudLabels\b[^}]*\} from "\.\/view\/hud-labels"/);
  });
});

// Contract of #224 C8: the keyboard layouts are identity's data (ARCHITECTURE 8.2). The race reaches them
// through `@/features/identity` only, from one module, `view/machine-rows.ts`, a server function the race
// page calls: the identity barrel is server-only at runtime, so no component, no selector and no other race
// module imports it (a client module of the race would pull it into the browser).
describe("the layouts reach the race through one server module (#224 C8)", () => {
  const feature = path.join(root, "src/features/race");
  const modules = sources(feature).filter((f) => !isTest(f));
  const rows = path.join(feature, "view/machine-rows.ts");

  it("view/machine-rows.ts is the only race module that imports @/features/identity", () => {
    const hits = modules
      .filter((f) =>
        specifiers(readFileSync(f, "utf8")).some((s) => /^@\/features\/identity(\/|$)/.test(s)),
      )
      .map((f) => path.relative(root, f));
    expect(hits).toEqual(["src/features/race/view/machine-rows.ts"]);
    for (const s of specifiers(readFileSync(rows, "utf8")).filter((x) => x.includes("identity"))) {
      expect(s, "through the index only").toBe("@/features/identity");
    }
  });

  it("the components and the machine selector import nothing from @/features/identity", () => {
    const client = [
      ...sources(components).filter((f) => !isTest(f)),
      path.join(feature, "view/machine-props.ts"),
    ];
    for (const file of client) {
      for (const s of specifiers(readFileSync(file, "utf8"))) {
        expect(s, path.relative(root, file)).not.toMatch(/features\/identity|(^|\/)identity(\/|$)/);
      }
    }
  });

  it("machine-rows is a server module reached only through the race index", () => {
    expect(readFileSync(rows, "utf8")).toMatch(/^"use server";/);
    const importers = sources(path.join(root, "src"))
      .filter((f) => !isTest(f))
      .filter((f) => specifiers(readFileSync(f, "utf8")).some((s) => /view\/machine-rows$/.test(s)))
      .map((f) => path.relative(root, f));
    expect(importers).toEqual(["src/features/race/index.ts"]);
    expect(race.machineRows).toBeTypeOf("function");
  });

  it("the machine modules import no skin outside the registry and no engine or protocol", () => {
    const machine = sources(path.join(components, "machine")).filter((f) => !isTest(f));
    expect(machine.length).toBeGreaterThan(3);
    for (const file of machine) {
      for (const s of specifiers(readFileSync(file, "utf8"))) {
        expect(s, path.relative(root, file)).not.toMatch(/^@fifth-copy\/(engine|protocol)/);
        if (!file.endsWith(path.join("machine", "skins", "index.ts"))) {
          expect(s, path.relative(root, file)).not.toMatch(/(^|\/)skins\/(?!index$)[\w-]+$/);
        }
      }
    }
  });
});

// Contract of #559 C8: the engine's reducers reach the race feature through one module, the local
// prediction (ADR 0007: the client applies the engine's own functions, never a copy); the components stay
// presentational (no engine, no protocol, no socket client), the typing input included.
describe("engine reducers only in the prediction (#559 C8)", () => {
  const feature = path.join(root, "src/features/race");
  const modules = sources(feature).filter((f) => !isTest(f));
  const REDUCERS =
    /\b(applyKeystroke|continueMode|blockMode|backspace|initialState|finishIfDone)\b/;

  it("client/prediction.ts is the only module of src/features/race that imports @fifth-copy/engine", () => {
    const hits = modules
      .filter((f) =>
        specifiers(readFileSync(f, "utf8")).some((s) => /^@fifth-copy\/engine(\/|$)/.test(s)),
      )
      .map((f) => path.relative(root, f));
    expect(hits).toEqual(["src/features/race/client/prediction.ts"]);
  });

  it("the prediction hands no reducer on (no re-export of an engine function)", () => {
    const names = Object.keys(prediction);
    expect(names).toContain("createPrediction");
    for (const name of names) expect(name, name).not.toMatch(REDUCERS);
    const source = readFileSync(path.join(feature, "client/prediction.ts"), "utf8");
    expect(source).not.toMatch(
      /export\s*\{[^}]*\b(applyKeystroke|continueMode|blockMode)\b[^}]*\}\s*from/,
    );
  });

  it("covers the typing input: components/race-input.tsx is presentational too", () => {
    expect(FILES.map((f) => path.relative(components, f))).toContain("race-input.tsx");
  });

  it("C9 exports RaceInput through the race index", () => {
    expect(race.RaceInput).toBe(RaceInput);
  });
});

// Contract of #220 C7: the engine decides right, wrong and the jam (ADR 0007); the store and the view only
// carry what it decided. Outside the prediction no module of the race feature compares the engine's
// counters or a key with the text.
describe("no second comparison (#220 C7)", () => {
  const feature = path.join(root, "src/features/race");
  const predictionFile = path.join(feature, "client/prediction.ts");
  const modules = sources(feature).filter((f) => !isTest(f) && f !== predictionFile);
  /** A counter compared (`errors >`, `< state.correct`; an arrow `=>` is no comparison) or a char of the text read (`text[i]`). */
  const COMPARISON =
    /\b(errors|correct)\s*[<>]=?|(?<!=)[<>]=?\s*[\w.?]*\b(errors|correct)\b|\btext\s*\[|\btext\.(at|charAt|codePointAt)\(/;

  it("covers the store, the views, the seat and the components", () => {
    const rel = modules.map((f) => path.relative(feature, f));
    for (const f of [
      "client/store.ts",
      "client/typing.ts",
      "view/typed-view.ts",
      "view/machine-props.ts",
      "seat/race-seat-live.tsx",
      "components/machine/typing-machine-live.tsx",
    ]) {
      expect(rel, f).toContain(f);
    }
  });

  for (const file of modules) {
    it(`${path.relative(root, file)} compares no counter and reads no char of the text`, () => {
      const code = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      expect(code.match(COMPARISON)?.[0] ?? null, file).toBeNull();
    });
  }

  it("the prediction is where the engine's numbers are read (the jam, the struck key, the pop stamp)", () => {
    expect(readFileSync(predictionFile, "utf8")).toMatch(COMPARISON);
  });
});
