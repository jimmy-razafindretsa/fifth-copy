import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// #986: package.json `sideEffects` tells the bundler which app modules run code on import. Every other
// module is side-effect free, so a route that imports one name from a feature's index.ts no longer pulls
// in the whole barrel and every client component behind it (the first-load JS of every route was over the
// ADR 0018 budget). The flip side: a module imported only for what it does (`import "./merge-step";`)
// is dropped unless it is listed. This test keeps the list in step with the code.
const root = process.cwd();
const src = path.join(root, "src");
const sideEffects = (
  JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
    sideEffects?: unknown;
  }
).sideEffects;

/** The package.json rule: `./path` is one file, a pattern without a slash matches a file name anywhere. */
function listed(file: string): boolean {
  if (!Array.isArray(sideEffects)) return false;
  const rel = `./${path.relative(root, file).split(path.sep).join("/")}`;
  return sideEffects.some((p: string) => {
    if (p.startsWith("./")) return p === rel;
    if (p.includes("/")) throw new Error(`unsupported sideEffects pattern ${p}`);
    const re = new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")}$`);
    return re.test(path.basename(file));
  });
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "generated" ? [] : sources(full);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [full] : [];
  });
}

function resolve(from: string, spec: string): string | null {
  const base = spec.startsWith("@/")
    ? path.join(src, spec.slice(2))
    : path.resolve(path.dirname(from), spec);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
  return (
    candidates.find((c) => existsSync(c) && !c.endsWith(path.sep) && /\.[a-z]+$/.test(c)) ?? null
  );
}

const files = sources(src);
/** `import "<spec>";` of an app module (relative or `@/`): imported for its side effect alone. */
const bareImports = files.flatMap((file) =>
  [...readFileSync(file, "utf8").matchAll(/^import "((?:\.{1,2}|@)\/[^"]+)";$/gm)].map((m) => ({
    file,
    spec: m[1]!,
  })),
);

describe("package.json sideEffects (#986)", () => {
  it("is a list (never `false`) that keeps stylesheets", () => {
    expect(Array.isArray(sideEffects)).toBe(true);
    expect(listed(path.join(src, "app/globals.css"))).toBe(true);
  });

  it("lists every app module imported only for its side effect", () => {
    expect(bareImports.length).toBeGreaterThan(0);
    const missing = bareImports
      .map(({ file, spec }) => ({ from: path.relative(root, file), spec, to: resolve(file, spec) }))
      .filter(({ to }) => to === null || !listed(to))
      .map(({ from, spec }) => `${from}: import "${spec}"`);
    expect(missing).toEqual([]);
  });

  it("lists every module that registers a guest-merge step on import (#56)", () => {
    const registering = files.filter((f) =>
      /^(?:for \(.*\) )?registerMergeStep\(/m.test(readFileSync(f, "utf8")),
    );
    expect(registering.length).toBeGreaterThan(0);
    expect(registering.filter((f) => !listed(f)).map((f) => path.relative(root, f))).toEqual([]);
  });

  it("lists only files that exist", () => {
    const paths = (sideEffects as string[]).filter((p) => p.startsWith("./"));
    expect(paths.filter((p) => !existsSync(path.join(root, p)))).toEqual([]);
  });
});
