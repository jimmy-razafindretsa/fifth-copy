/**
 * First-load JS budget for one App Router route (ADR 0013: 250 kB gzip), card #521.
 * Next 16.3's `next build` no longer prints a size column, so this reads the build output directly:
 *   rootMainFiles      from .next/server/app/<route>/page/build-manifest.json
 *   layout + page      entryJSFiles from .next/server/app/<route>/page_client-reference-manifest.js
 * Files are deduped, gzipped (level 9) and summed in decimal kB. Polyfills are nomodule-only and excluded.
 *
 *   npm run build && npx tsx scripts/bundle-budget.ts '/lobby/[code]'
 * Exit: 0 under budget, 1 over budget, 2 usage / unknown route / unreadable build.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import zlib from "node:zlib";

export const BUDGET_KB = 250;

type Io = { log: (s: string) => void; error: (s: string) => void };
type Options = { distDir?: string; io?: Io };

class BudgetError extends Error {}

function routeDir(distDir: string, route: string): string {
  if (!route.startsWith("/")) throw new BudgetError(`route must start with "/": ${route}`);
  const segments = route.split("/").filter(Boolean);
  if (segments.some((s) => s === "." || s === ".."))
    throw new BudgetError(`invalid route ${route}`);
  return path.join(distDir, "server/app", ...segments);
}

function readEntryJsFiles(file: string): Record<string, string[]> {
  const sandbox: { __RSC_MANIFEST?: Record<string, { entryJSFiles?: Record<string, string[]> }> } =
    {};
  vm.runInNewContext(fs.readFileSync(file, "utf8"), { globalThis: sandbox }, { timeout: 1000 });
  const manifests = Object.values(sandbox.__RSC_MANIFEST ?? {});
  if (manifests.length !== 1 || !manifests[0]?.entryJSFiles) {
    throw new BudgetError(`no entryJSFiles in ${file}`);
  }
  return manifests[0].entryJSFiles;
}

/** The deduped first-load JS files of a route, relative to distDir. */
export function firstLoadFiles(distDir: string, route: string): string[] {
  const dir = routeDir(distDir, route);
  const buildManifest = path.join(dir, "page/build-manifest.json");
  const clientManifest = path.join(dir, "page_client-reference-manifest.js");
  if (!fs.existsSync(buildManifest) || !fs.existsSync(clientManifest)) {
    throw new BudgetError(
      `unknown route ${route} (no page manifests under ${path.relative(process.cwd(), dir) || dir}; run npm run build first?)`,
    );
  }
  const { rootMainFiles = [] } = JSON.parse(fs.readFileSync(buildManifest, "utf8")) as {
    rootMainFiles?: string[];
  };
  const entries = readEntryJsFiles(clientManifest);
  const pageKeys = Object.keys(entries).filter((k) => k.endsWith("/page"));
  if (pageKeys.length !== 1)
    throw new BudgetError(`expected one page entry in ${clientManifest}, found ${pageKeys.length}`);
  const layoutKeys = Object.keys(entries).filter((k) => k.endsWith("/layout"));
  return [
    ...new Set([
      ...rootMainFiles,
      ...layoutKeys.flatMap((k) => entries[k]!),
      ...entries[pageKeys[0]!]!,
    ]),
  ];
}

export function gzipKb(distDir: string, files: string[]): number {
  const bytes = files.reduce((sum, f) => {
    const p = path.join(distDir, f);
    if (!fs.existsSync(p)) throw new BudgetError(`missing chunk ${f}`);
    return sum + zlib.gzipSync(fs.readFileSync(p), { level: 9 }).length;
  }, 0);
  return bytes / 1000;
}

export function run(
  argv: string[],
  { distDir = path.resolve(".next"), io = console }: Options = {},
): number {
  const route = argv[0];
  if (!route || argv.length > 1) {
    io.error("usage: npx tsx scripts/bundle-budget.ts '<route>'   e.g. '/lobby/[code]'");
    return 2;
  }
  try {
    const kb = gzipKb(distDir, firstLoadFiles(distDir, route));
    io.log(`${route} ${kb.toFixed(1)} kB gzip (budget ${BUDGET_KB})`);
    return kb > BUDGET_KB ? 1 : 0;
  } catch (e) {
    if (!(e instanceof BudgetError) && !(e instanceof SyntaxError)) throw e;
    io.error(`bundle-budget: ${e.message}`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  process.exit(run(process.argv.slice(2)));
}
