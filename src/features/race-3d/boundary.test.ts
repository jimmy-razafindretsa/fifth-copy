import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as race3d from "./index";

// #563 C1 (ADR 0013, 0017): race-3d's public face is `RaceScene` (a client leaf) and `detectWebGL2()`; the
// race route reaches it only through `next/dynamic(() => import("@/features/race-3d"), { ssr: false })`
// in a client component that renders after the HUD has mounted (an effect gates it). C7's import rules
// are dependency-cruiser's (`npm run boundaries`).
const root = process.cwd();
const read = (p: string) => readFileSync(path.join(root, p), "utf8");
const LEAF = "src/app/race/[raceId]/seat-scene.tsx";

describe("race-3d public face (#563 C1)", () => {
  it("exports RaceScene and detectWebGL2", () => {
    expect(typeof race3d.RaceScene).toBe("function");
    expect(typeof race3d.detectWebGL2).toBe("function");
    expect(read("src/features/race-3d/race-scene.tsx")).toMatch(/^"use client";/);
  });

  it("detectWebGL2 is false when getContext('webgl2') answers null", () => {
    const g = globalThis as { document?: unknown };
    const original = g.document;
    try {
      g.document = { createElement: () => ({ getContext: () => null }) };
      expect(race3d.detectWebGL2()).toBe(false);
      g.document = { createElement: () => ({ getContext: () => ({}) }) };
      expect(race3d.detectWebGL2()).toBe(true);
    } finally {
      g.document = original;
    }
  });

  it("the route loads it only with next/dynamic, ssr: false, from a client leaf", () => {
    const leaf = read(LEAF);
    expect(leaf).toMatch(/^"use client";/);
    expect(leaf).toContain('import dynamic from "next/dynamic";');
    expect(leaf).toMatch(
      // the `.then` may also keep the chunk's frame-budget policy (#695 C2) before it returns RaceScene
      /dynamic\(\s*\(\)\s*=>\s*import\("@\/features\/race-3d"\)(\.then\(\((\w+)\) => (\2\.RaceScene|\{[\s\S]*?return \2\.RaceScene;\s*\})\))?\s*,\s*\{\s*ssr:\s*false,?\s*\},?\s*\)/,
    );
    // no other mention of race-3d in the route: no static import, no second dynamic one
    const files = readdirSync(path.join(root, "src/app/race/[raceId]")).filter((f) =>
      /\.tsx?$/.test(f),
    );
    const mentions = files.flatMap((f) =>
      [...read(`src/app/race/[raceId]/${f}`).matchAll(/@\/features\/race-3d/g)].map(() => f),
    );
    expect(mentions).toEqual(["seat-scene.tsx"]);
  });

  it("the leaf renders nothing until an effect has run after mount (HUD first)", () => {
    const leaf = read(LEAF);
    expect(leaf).toContain('useState<Mode>("off")');
    expect(leaf).toContain('if (mode === "off") return null;');
    expect(leaf).toMatch(
      /useEffect\(\(\) => \{[\s\S]*?setMode\(hasWebGL2\(\) \? "loading" : "fallback"\)/,
    );
    expect(read("src/app/race/[raceId]/page.tsx")).toContain("scene={<SeatScene");
  });
});
