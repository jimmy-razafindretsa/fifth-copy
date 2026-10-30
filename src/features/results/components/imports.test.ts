import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Contract of #300 C9: the route composes only the results feature (through its index) and identity;
// the two client leaves are imported by the feature's server components, never by its index (the index is
// server-only); Prisma stays in queries/ (and the existing write path in actions/), never in a component,
// the view model or the medal messages.
const root = process.cwd();
const feature = path.join(root, "src/features/results");
const app = path.join(root, "src/app/results");

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
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [full] : [];
  });
}

const rel = (f: string) => path.relative(root, f);
const CLIENT_LEAVES = ["components/filing-notice.tsx", "components/podium-medal.tsx"];
const PRISMA = /^@\/server\/db$|^@\/generated\/prisma|^@prisma\//;

describe("results imports (#300 C9)", () => {
  it("src/app/results/** imports features only through @/features/results and @/features/identity", () => {
    const files = sources(app);
    expect(files.map(rel)).toContain("src/app/results/[raceId]/page.tsx");
    for (const file of files) {
      for (const s of specifiers(readFileSync(file, "utf8")).filter((x) =>
        x.startsWith("@/features"),
      )) {
        expect(["@/features/results", "@/features/identity"], rel(file)).toContain(s);
      }
      for (const s of specifiers(readFileSync(file, "utf8"))) {
        expect(s, rel(file)).not.toMatch(PRISMA);
        expect(s, rel(file)).not.toMatch(/^@\/server\//);
      }
    }
  });

  it("the client leaves say so and are imported by server components, never by the index", () => {
    for (const leaf of CLIENT_LEAVES) {
      expect(readFileSync(path.join(feature, leaf), "utf8"), leaf).toMatch(/^"use client";/);
    }
    const index = specifiers(readFileSync(path.join(feature, "index.ts"), "utf8"));
    expect(index).not.toContain("./components/filing-notice");
    expect(index).not.toContain("./components/podium-medal");
    const importers = (leaf: string) =>
      sources(path.join(root, "src"))
        .filter((f) =>
          specifiers(readFileSync(f, "utf8")).some(
            (s) => s.endsWith(`/${path.basename(leaf, ".tsx")}`) && !s.startsWith("@/components"),
          ),
        )
        .map(rel);
    expect(importers("components/filing-notice.tsx")).toEqual([
      "src/features/results/components/dawn-report-screen.tsx",
    ]);
    expect(importers("components/podium-medal.tsx")).toEqual([
      "src/features/results/components/podium.tsx",
    ]);
    for (const server of ["components/podium.tsx", "components/dawn-report-screen.tsx"]) {
      expect(readFileSync(path.join(feature, server), "utf8"), server).not.toMatch(/"use client"/);
    }
  });

  it("the client leaves import no server module, no catalog index and no schema library", () => {
    for (const leaf of CLIENT_LEAVES) {
      for (const s of specifiers(readFileSync(path.join(feature, leaf), "utf8"))) {
        expect(s, leaf).not.toMatch(/^@\/server|^@\/i18n$|^zod$|^\.\.\/index$|^@\/features\//);
        expect(s, leaf).not.toMatch(PRISMA);
      }
    }
  });

  it("Prisma only in queries/ (and the existing write path in actions/)", () => {
    const hits = sources(feature)
      .filter((f) => specifiers(readFileSync(f, "utf8")).some((s) => PRISMA.test(s)))
      .map((f) => path.relative(feature, f).split(path.sep)[0]);
    expect(new Set(hits)).toEqual(new Set(["queries", "actions"]));
    for (const dir of ["components", "view"]) {
      for (const f of sources(path.join(feature, dir))) {
        for (const s of specifiers(readFileSync(f, "utf8"))) expect(s, rel(f)).not.toMatch(PRISMA);
      }
    }
  });
});
