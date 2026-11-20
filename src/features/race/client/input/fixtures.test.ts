import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ASSUMPTION_REF, FIXTURE_CASE_IDS, FIXTURE_CASES, keyEventFixtureSchema } from "./fixture";
import { FIXTURE_DIR, loadFixtures } from "./fixtures";

// Contract of #1001 C2: one fixture per documented OS/browser event model and case, written by hand from
// the "Documented event sequences" rows of work/log/1001.md, each validated by `keyEventFixtureSchema`
// with `source: "docs"`, a `ref` URL and the `expected` characters; never claimed as recorded. A sequence
// no source documents carries `ref: "assumption"` and a note, and its row says "undocumented: assumption".

const LOG = readFileSync(path.join(process.cwd(), "work/log/1001.md"), "utf8");
const table = LOG.split(/^## Documented event sequences/m)[1]?.split(/^## /m)[0] ?? "";
const files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".json"));

describe("dead-key fixtures from the docs (#1001 C2)", () => {
  it("every file parses with keyEventFixtureSchema and is named after its own fields", () => {
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const raw = JSON.parse(readFileSync(path.join(FIXTURE_DIR, file), "utf8"));
      const parsed = keyEventFixtureSchema.safeParse(raw);
      expect(parsed.success, `${file}: ${parsed.error?.message}`).toBe(true);
      const f = parsed.data!;
      expect(file).toBe(`${f.os}-${f.browser}-${f.layout}-${f.case}.json`);
    }
  });

  it("each is from the docs, never a recording: source docs, an https ref or a stated assumption, the case's expected characters", () => {
    for (const { file, fixture } of loadFixtures()) {
      expect(fixture.source, file).toBe("docs");
      if (fixture.ref === ASSUMPTION_REF) expect(fixture.note, file).toBeTruthy();
      else expect(fixture.ref, file).toMatch(/^https:\/\//);
      expect(fixture.expected, file).toBe(FIXTURE_CASES[fixture.case]);
      expect(JSON.stringify(fixture), file).not.toMatch(/record/i);
    }
  });

  it("each names a row of the log's table; the row cites the ref, or says the sequence is an assumption", () => {
    for (const { file, fixture } of loadFixtures()) {
      const row = table.split("\n").find((line) => line.startsWith(`| ${fixture.row} |`));
      expect(row, `${file}: row ${fixture.row}`).toBeDefined();
      if (fixture.ref === ASSUMPTION_REF) expect(row, file).toContain("undocumented: assumption");
      else expect(row, `${file}: ${fixture.ref}`).toContain(fixture.ref);
    }
  });

  it("every case is covered for every documented OS and browser pair", () => {
    const pairs = new Set(loadFixtures().map(({ fixture: f }) => `${f.os}/${f.browser}`));
    expect([...pairs].sort()).toEqual(
      [
        "chromeos/chrome",
        "macos/chrome",
        "macos/edge",
        "macos/firefox",
        "macos/safari",
        "windows/chrome",
        "windows/edge",
        "windows/firefox",
      ].sort(),
    );
    for (const pair of pairs) {
      const cases = loadFixtures()
        .filter(({ fixture: f }) => `${f.os}/${f.browser}` === pair)
        .map(({ fixture: f }) => f.case)
        .sort();
      expect(cases, pair).toEqual([...FIXTURE_CASE_IDS].sort());
    }
  });

  it("both event models are present: composition, and a Dead key without composition", () => {
    const all = loadFixtures().map(({ fixture }) => fixture.events);
    const composed = all.filter((evs) => evs.some((e) => e.type === "compositionend"));
    const deadOnly = all.filter(
      (evs) =>
        evs.some((e) => e.key === "Dead") && !evs.some((e) => e.type.startsWith("composition")),
    );
    expect(composed.length).toBeGreaterThan(0);
    expect(deadOnly.length).toBeGreaterThan(0);
  });

  it("refuses a recorded, ref-less or unexpected fixture", () => {
    const good = loadFixtures()[0]!.fixture;
    for (const bad of [
      { ...good, source: "recorded" },
      { ...good, ref: undefined },
      { ...good, ref: "http://example.com" },
      { ...good, ref: ASSUMPTION_REF, note: undefined },
      { ...good, note: "a note without an assumption" },
      { ...good, expected: "" },
      { ...good, events: [] },
      { ...good, extra: 1 },
    ]) {
      expect(keyEventFixtureSchema.safeParse(bad).success, JSON.stringify(bad).slice(0, 80)).toBe(
        false,
      );
    }
  });
});
