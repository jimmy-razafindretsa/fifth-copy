import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { firstLoadFiles } from "../../../scripts/bundle-budget";

// Contracts of #561 C7 and C9 (ADR 0013): three.js lives only in src/features/race-3d, loaded lazily by
// the race route after the HUD; the HUD route itself never ships it. Two checks:
// - sources: the race feature and the race route import neither `three` nor race-3d statically, and the
//   route composes only the race and lobby features, through their index (dependency-cruiser enforces
//   index-only; this pins which features);
// - build: after `npm run build`, no first-load chunk of `/race/[raceId]` carries three.js (its
//   `THREE.`-prefixed messages survive minification). Without a build this half is skipped; the C7
//   verify command builds first.
const root = process.cwd();
const ROUTE = "/race/[raceId]";
const distDir = path.join(root, ".next");
const built = existsSync(path.join(distDir, "server/app/race/[raceId]/page/build-manifest.json"));

function sources(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sources(full);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [full] : [];
  });
}

/** Every module specifier of a source file, with whether it is a dynamic `import()`. */
function specifiers(source: string): { spec: string; dynamic: boolean }[] {
  return [
    ...[...source.matchAll(/(?:import|export)\s[^"';]*?from\s*["']([^"']+)["']/g)].map((m) => ({
      spec: m[1]!,
      dynamic: false,
    })),
    ...[...source.matchAll(/^\s*import\s*["']([^"']+)["']/gm)].map((m) => ({
      spec: m[1]!,
      dynamic: false,
    })),
    ...[...source.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g)].map((m) => ({
      spec: m[1]!,
      dynamic: true,
    })),
  ];
}

const RACE = sources(path.join(root, "src/features/race"));
const ROUTE_FILES = sources(path.join(root, "src/app/race"));
const isThree = (s: string) => s === "three" || s.startsWith("three/");
const isRace3d = (s: string) => /(^|\/)features\/race-3d(\/|$)/.test(s);

describe("the race route ships no three.js (#561 C7, C9)", () => {
  it("covers the route page and the seat view", () => {
    const rel = [...RACE, ...ROUTE_FILES].map((f) => path.relative(root, f));
    expect(rel).toContain("src/app/race/[raceId]/page.tsx");
    expect(rel).toContain("src/features/race/seat/race-seat.tsx");
    expect(rel).toContain("src/features/race/client/store.ts");
  });

  for (const file of [...RACE, ...ROUTE_FILES]) {
    it(`${path.relative(root, file)} imports neither three nor race-3d statically`, () => {
      for (const { spec, dynamic } of specifiers(readFileSync(file, "utf8"))) {
        expect(isThree(spec), spec).toBe(false);
        if (isRace3d(spec)) expect(dynamic, `${spec} must be a lazy import()`).toBe(true);
      }
    });
  }

  it("src/app/race composes only @/features/race and @/features/lobby, through their index", () => {
    const features = ROUTE_FILES.flatMap((f) =>
      specifiers(readFileSync(f, "utf8"))
        .map((s) => s.spec)
        .filter((s) => s.startsWith("@/features/")),
    );
    expect(features.length).toBeGreaterThan(0);
    for (const s of features) expect(["@/features/race", "@/features/lobby"]).toContain(s);
  });

  it("nothing in src imports src/features/race-3d statically", () => {
    const hits = sources(path.join(root, "src"))
      .filter((f) => !f.includes(`${path.sep}features${path.sep}race-3d${path.sep}`))
      .filter((f) =>
        specifiers(readFileSync(f, "utf8")).some((s) => isRace3d(s.spec) && !s.dynamic),
      )
      .map((f) => path.relative(root, f));
    expect(hits).toEqual([]);
  });

  it.skipIf(!built)("no first-load chunk of /race/[raceId] carries three.js", () => {
    const files = firstLoadFiles(distDir, ROUTE);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const js = readFileSync(path.join(distDir, file), "utf8");
      expect(js, file).not.toMatch(/THREE\.(WebGLRenderer|Object3D|BufferGeometry)/);
      expect(js, file).not.toMatch(/node_modules[\\/]three[\\/]/);
    }
  });
});
