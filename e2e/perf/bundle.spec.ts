import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { firstLoadFiles } from "../../scripts/bundle-budget";

// Contract of #563 C6 (ADR 0017 option A, ADR 0013 budgets): `three` is in no Next chunk of any route. The
// seat scene loads three.js from `/3d/vendor/` inside its embed page, so neither the first load of the
// landing, the waiting room and the race route nor any async chunk under `.next/static/chunks` carries it.
// Reads the production build (`npm run build` first; CI builds before e2e); no browser, desktop project.

const distDir = path.join(process.cwd(), ".next");
const built = existsSync(path.join(distDir, "server/app/race/[raceId]/page/build-manifest.json"));
const ROUTES = ["/", "/lobby/[code]", "/race/[raceId]"] as const;
/** three.js survives minification through its `THREE.`-prefixed messages and its module path. */
const THREE_SIGNATURES = [
  /THREE\.(WebGLRenderer|Object3D|BufferGeometry)/,
  /node_modules[\\/]three[\\/]/,
];

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? files(full) : /\.m?js$/.test(e.name) ? [full] : [];
  });
}

const carriesThree = (file: string) => {
  const js = readFileSync(file, "utf8");
  return THREE_SIGNATURES.some((re) => re.test(js));
};

test.describe("#563 C6 three.js is in no Next chunk", () => {
  test.skip(({ viewport }) => viewport?.width !== 1280, "no browser: desktop project only");
  test.skip(!built, "needs a production build (npm run build)");

  for (const route of ROUTES) {
    test(`the first load of ${route}`, () => {
      const first = firstLoadFiles(distDir, route);
      expect(first.length).toBeGreaterThan(0);
      for (const file of first) expect(carriesThree(path.join(distDir, file)), file).toBe(false);
    });
  }

  test("every file under .next/static/chunks", () => {
    const all = files(path.join(distDir, "static/chunks"));
    expect(all.length).toBeGreaterThan(0);
    expect(all.filter(carriesThree).map((f) => path.relative(distDir, f))).toEqual([]);
  });

  test("the race-3d module is an async chunk of its own (the route loads it after the HUD)", () => {
    const first = new Set(firstLoadFiles(distDir, "/race/[raceId]"));
    const scene = files(path.join(distDir, "static/chunks")).filter((f) =>
      readFileSync(f, "utf8").includes("/3d/seat.html"),
    );
    expect(scene.length, "a chunk mentions /3d/seat.html").toBeGreaterThan(0);
    for (const f of scene) expect(first.has(path.relative(distDir, f)), f).toBe(false);
  });
});
