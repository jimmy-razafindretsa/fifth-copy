import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isClean } from "./is-clean";
import { EN } from "./lists/en";
import { FR } from "./lists/fr";
import { normalizeRuns } from "./normalize";

describe("word lists (C2)", () => {
  it.each([
    ["fr", FR],
    ["en", EN],
  ] as const)("%s holds >= 150 entries, unique after normalization", (_lang, list) => {
    expect(list.length).toBeGreaterThanOrEqual(150);
    const forms = list.map((e) => normalizeRuns(e.word));
    for (const f of forms) expect(f.length).toBeGreaterThan(0);
    expect(new Set(forms).size).toBe(forms.length);
  });

  it.each(["fr", "en"])("%s.ts starts with a header naming the source and the reviewer", (lang) => {
    const file = readFileSync(path.join(__dirname, "lists", `${lang}.ts`), "utf8");
    const header = file.slice(0, file.indexOf("export"));
    expect(header).toMatch(/^\/\/ Source: \S.+$/m);
    expect(header).toMatch(/^\/\/ Reviewer: \S.+$/m);
  });

  it("every entry is blocked on its own, embedded entries also inside a word", () => {
    for (const e of [...FR, ...EN]) {
      expect(isClean(e.word), e.word).toBe(false);
      if (e.embedded) expect(isClean(`Zz${e.word.toLowerCase()}Zz`), e.word).toBe(false);
    }
  });

  it("whole-token entries do not match inside a longer word", () => {
    const whole = [...FR, ...EN].filter((e) => !e.embedded && /^\p{L}+$/u.test(e.word));
    expect(whole.length).toBeGreaterThan(100);
    // "Scunthorpe"-style: a whole-token entry inside another word passes.
    for (const w of ["Scunthorpe", "Cockburn", "Penistone", "Monique", "Salopette", "Essex"]) {
      expect(isClean(w), w).toBe(true);
    }
  });
});

describe("isClean (C2 matching)", () => {
  it.each([
    "f.u.c.k",
    "fuck_you",
    "FuckYou",
    "fuuuuck",
    "F U C K",
    "sh1t",
    "SH1THead",
    "a$$hole",
    "b1tch",
    "xXbitchXx",
    "câlisse",
    "Tabarnak",
    "t@b@rn4k",
    "fu​ck",
    "ｆｕｃｋ",
  ])("blocks %s", (name) => {
    expect(isClean(name)).toBe(false);
  });

  it.each([
    "Scunthorpe",
    "Button",
    "Niger",
    "Bob",
    "Sparrow-123",
    "Hérisson",
    "Assassin",
    "Therapist",
    "Matsushita",
    "Computer",
    "",
  ])("allows %s", (name) => {
    expect(isClean(name)).toBe(true);
  });
});

/**
 * The timed case uses the minimum of RUNS samples (#647, the #600 pattern in
 * `services/race-server/src/rooms/snapshot.bench.test.ts`): background load (other suites, other
 * card worktrees) only ever adds time to a sample, so the fastest one is the closest to the code's
 * own cost, while a single sample rose with the machine's load and failed unchanged code. The
 * 200 ms budget stays; a regression still fails because every sample, the fastest included, gets
 * slower.
 */
const RUNS = 20;
const fastest = (xs: number[]) => Math.min(...xs);
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

describe("isClean performance (C5)", () => {
  it("runs 10,000 checks of 20-character names in under 200 ms (minimum of 20)", () => {
    const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123456789_-.";
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const names = Array.from({ length: 10_000 }, () =>
      Array.from({ length: 20 }, () => alphabet[Math.floor(rand() * alphabet.length)]).join(""),
    );
    for (const n of names.slice(0, 500)) isClean(n); // warm-up
    const times: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const start = performance.now();
      for (const n of names) isClean(n);
      times.push(performance.now() - start);
    }
    console.log(
      JSON.stringify({ bench: "isClean", minMs: fastest(times), medianMs: median(times) }),
    );
    expect(fastest(times)).toBeLessThan(200);
  });
});
