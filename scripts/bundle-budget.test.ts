import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { run } from "./bundle-budget";

// Card #521 C2: first-load JS budget (ADR 0013, 250 kB gzip) from a fixture `.next` manifest set.
// Random bytes do not compress, so gzip size ~= raw size and the totals are predictable.

let distDir: string;

const chunk = (name: string, bytes: number) => {
  fs.writeFileSync(path.join(distDir, "static/chunks", name), crypto.randomBytes(bytes));
  return `static/chunks/${name}`;
};

const writeRoute = (segments: string[], rootMain: string[], entries: Record<string, string[]>) => {
  const dir = path.join(distDir, "server/app", ...segments);
  fs.mkdirSync(path.join(dir, "page"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "page/build-manifest.json"),
    JSON.stringify({
      polyfillFiles: ["static/chunks/poly.js"],
      rootMainFiles: rootMain,
      pages: {},
    }),
  );
  const routeKey = `/${[...segments, "page"].join("/")}`;
  fs.writeFileSync(
    path.join(dir, "page_client-reference-manifest.js"),
    `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};\n` +
      `globalThis.__RSC_MANIFEST[${JSON.stringify(routeKey)}] = ${JSON.stringify({ clientModules: {}, entryJSFiles: entries })};`,
  );
};

const capture = () => {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { log: (s: string) => out.push(s), error: (s: string) => err.push(s) } };
};

beforeAll(() => {
  distDir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-budget-"));
  fs.mkdirSync(path.join(distDir, "static/chunks"), { recursive: true });
  const main = chunk("main.js", 100_000);
  const layout = chunk("layout.js", 50_000);
  const small = chunk("small.js", 20_000);
  const big = chunk("big.js", 200_000);
  const notFound = chunk("not-found.js", 400_000);
  chunk("poly.js", 400_000); // polyfills are nomodule-only: not first-load JS for modern browsers
  const entries = (page: string, pageFiles: string[]) => ({
    "[project]/src/app/layout": [layout],
    "[project]/src/app/not-found": [layout, notFound],
    [`[project]/src/app${page}`]: [layout, ...pageFiles],
  });
  writeRoute(["lobby", "[code]"], [main], entries("/lobby/[code]/page", [small]));
  writeRoute(["race", "[code]"], [main], entries("/race/[code]/page", [big]));
});

afterAll(() => fs.rmSync(distDir, { recursive: true, force: true }));

describe("bundle-budget", () => {
  it("prints one line and exits 0 under budget (root main + layout + page, deduped)", () => {
    const c = capture();
    expect(run(["/lobby/[code]"], { distDir, io: c.io })).toBe(0);
    expect(c.out).toHaveLength(1);
    const m = /^\/lobby\/\[code\] (\d+\.\d) kB gzip \(budget 250\)$/.exec(c.out[0]!);
    expect(m, c.out[0]).not.toBeNull();
    const kb = Number(m![1]);
    expect(kb).toBeGreaterThan(169);
    expect(kb).toBeLessThan(171);
  });

  it("exits 1 over budget", () => {
    const c = capture();
    expect(run(["/race/[code]"], { distDir, io: c.io })).toBe(1);
    expect(c.out[0]).toMatch(/^\/race\/\[code\] 35\d\.\d kB gzip \(budget 250\)$/);
  });

  it("exits 2 with a message for an unknown route", () => {
    const c = capture();
    expect(run(["/nope"], { distDir, io: c.io })).toBe(2);
    expect(c.out).toHaveLength(0);
    expect(c.err.join("\n")).toMatch(/unknown route \/nope/);
  });

  it("exits 2 with usage when no route is given", () => {
    const c = capture();
    expect(run([], { distDir, io: c.io })).toBe(2);
    expect(c.err.join("\n")).toMatch(/usage/);
  });
});
