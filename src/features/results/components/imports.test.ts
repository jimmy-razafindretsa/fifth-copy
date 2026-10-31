import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Contract of #300 C9: the route composes only the results feature (through its index) and identity;
// the client leaves are imported by the feature's server components (or by each other), never by its index
// (the index is server-only); Prisma stays in queries/ (and the existing write path in actions/), never in a
// component, the view model or the embed messages. #688 C10: results reaches identity only through
// `@/features/identity`, and what the client leaves load reaches it with `import type` only (no three,
// no zod, no server module in a leaf).
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
const CLIENT_LEAVES = [
  "components/filing-notice.tsx",
  "components/podium-clerk.tsx",
  "components/plinth-mounts.tsx",
];
/** Plain modules the leaves load (no "use client" of their own): bundled for the browser too. */
const CLIENT_LOADED = ["embed-messages.ts", "view/dawn-report.ts", "components/podium-mount.ts"];
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
    expect(index).not.toContain("./components/podium-clerk");
    expect(index).not.toContain("./components/plinth-mounts");
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
    expect(importers("components/plinth-mounts.tsx")).toEqual([
      "src/features/results/components/podium.tsx",
    ]);
    expect(importers("components/podium-clerk.tsx")).toEqual([
      "src/features/results/components/plinth-mounts.tsx",
    ]);
    for (const server of ["components/podium.tsx", "components/dawn-report-screen.tsx"]) {
      expect(readFileSync(path.join(feature, server), "utf8"), server).not.toMatch(/"use client"/);
    }
  });

  it("the client leaves import no server module, no catalog index and no schema library", () => {
    for (const leaf of CLIENT_LEAVES) {
      for (const s of specifiers(readFileSync(path.join(feature, leaf), "utf8"))) {
        expect(s, leaf).not.toMatch(/^@\/server|^@\/i18n$|^zod$|^\.\.\/index$|^@\/features\//);
        expect(s, leaf).not.toMatch(/^three(\/|$)/);
        expect(s, leaf).not.toMatch(PRISMA);
      }
    }
  });

  it("results reaches identity only through its barrel; client-loaded modules only for types (#688)", () => {
    for (const file of sources(feature)) {
      for (const s of specifiers(readFileSync(file, "utf8")).filter((x) => /identity/.test(x))) {
        expect(s, rel(file)).toBe("@/features/identity");
      }
    }
    for (const mod of CLIENT_LOADED) {
      const text = readFileSync(path.join(feature, mod), "utf8");
      expect(text, mod).not.toMatch(/^"use client"/);
      for (const m of text.matchAll(/^import\s+(type\s+)?[^;]*?from\s*["']([^"']+)["']/gm)) {
        if (m[2]!.startsWith("@/features/")) expect(m[1], `${mod}: ${m[0]}`).toBe("type ");
        expect(m[2], mod).not.toMatch(/^@\/server|^zod$|^three(\/|$)/);
        expect(m[2], mod).not.toMatch(PRISMA);
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

  it("#301 C7 the ranking docket: exported by the index, no Prisma, engine or protocol module, no client", () => {
    const index = specifiers(readFileSync(path.join(feature, "index.ts"), "utf8"));
    expect(index).toContain("./components/ranking-table");
    expect(index).toContain("./view/ranking");
    for (const mod of ["components/ranking-table.tsx", "view/ranking.ts"]) {
      const text = readFileSync(path.join(feature, mod), "utf8");
      expect(text, mod).not.toMatch(/"use client"/);
      for (const s of specifiers(text)) {
        expect(s, mod).not.toMatch(PRISMA);
        expect(s, mod).not.toMatch(/^@fifth-copy\/(engine|protocol)(\/|$)|^@\/server/);
      }
    }
  });
});
