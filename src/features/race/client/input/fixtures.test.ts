import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { keyEventFixtureSchema } from "./fixture";
import {
  fixtureFileName,
  fixtureJson,
  guessMachine,
  MINIMUM_FIXTURE_SET,
  recordKeyEvent,
  type KeyEventFixture,
} from "./fixture-cases";

// Contract of #566 C2: every recorded fixture parses with keyEventFixtureSchema, sits under its own
// <os>-<layout>-<case>.json name, and the minimum set is on file. The fixtures are real recordings made on
// Windows, macOS and ChromeOS machines (C3): never write one by hand to make this pass.
const dir = path.join(process.cwd(), "src/features/race/client/input/fixtures");
const files = existsSync(dir)
  ? readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort()
  : [];

/** A schema specimen built in memory (not a recording, never written to fixtures/). */
const specimen: KeyEventFixture = {
  os: "windows",
  browser: "chrome",
  layout: "csa",
  case: "circumflex-e",
  events: [
    { type: "keydown", key: "Dead", code: "BracketLeft", isComposing: false, data: null, inputType: null },
    { type: "compositionend", key: null, code: null, isComposing: null, data: "ê", inputType: null },
  ],
  expected: "ê",
};

describe("keyEventFixtureSchema (#566 C2)", () => {
  it("accepts the fixture format the recorder copies", () => {
    expect(keyEventFixtureSchema.parse(JSON.parse(fixtureJson(specimen)))).toEqual(specimen);
  });

  it("rejects unknown ids, extra fields, an empty log and an empty expected text", () => {
    const bad = [
      { ...specimen, os: "linux" },
      { ...specimen, layout: "dvorak" },
      { ...specimen, extra: 1 },
      { ...specimen, events: [] },
      { ...specimen, expected: "" },
      { ...specimen, events: [{ ...specimen.events[0], type: "keyup" }] },
    ];
    for (const b of bad) expect(keyEventFixtureSchema.safeParse(b).success, JSON.stringify(b)).toBe(false);
  });

  it("names the minimum set: 7 cases x 3 layouts x Windows and macOS, plus macOS US Option combos", () => {
    expect(MINIMUM_FIXTURE_SET).toHaveLength(43);
    expect(MINIMUM_FIXTURE_SET).toContain("windows-csa-circumflex-e.json");
    expect(MINIMUM_FIXTURE_SET).toContain("macos-azerty-guillemets.json");
    expect(MINIMUM_FIXTURE_SET).toContain("macos-us-option-combos.json");
  });
});

describe("recordKeyEvent", () => {
  it("keeps the fields an event carries and nulls the rest", () => {
    const e = new Event("keydown") as Event & Record<string, unknown>;
    Object.assign(e, { key: "Dead", code: "BracketLeft", isComposing: false });
    expect(recordKeyEvent(e)).toEqual({
      type: "keydown",
      key: "Dead",
      code: "BracketLeft",
      isComposing: false,
      data: null,
      inputType: null,
    });
    expect(recordKeyEvent(new Event("keyup"))).toBeNull();
  });

  it("guesses the machine from the user agent", () => {
    expect(guessMachine("Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) Chrome/120.0 Safari/537.36")).toEqual({
      os: "chromeos",
      browser: "chrome",
    });
    expect(guessMachine("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/17.0 Safari/605.1.15")).toEqual(
      { os: "macos", browser: "safari" },
    );
    expect(guessMachine("Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36 Edg/120.0")).toEqual({
      os: "windows",
      browser: "edge",
    });
  });
});

describe("recorded fixtures (#566 C2, recorded in C3)", () => {
  it.each(files.length ? files : ["(none yet)"])("%s parses and is named after its fields", (file) => {
    if (!files.length) return;
    const parsed = keyEventFixtureSchema.safeParse(JSON.parse(readFileSync(path.join(dir, file), "utf8")));
    expect(parsed.error?.issues ?? [], file).toEqual([]);
    expect(file).toBe(fixtureFileName(parsed.data!));
  });

  it("holds the minimum set", () => {
    const missing = MINIMUM_FIXTURE_SET.filter((f) => !files.includes(f));
    expect(
      missing,
      `${missing.length} of ${MINIMUM_FIXTURE_SET.length} fixtures still to record on real machines (C3): ` +
        "open /design/keys, pick OS, browser, layout and case, type it, COPY FIXTURE, save as " +
        `src/features/race/client/input/fixtures/<os>-<layout>-<case>.json. Missing:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });
});
