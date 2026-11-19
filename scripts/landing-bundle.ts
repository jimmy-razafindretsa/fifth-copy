/**
 * What the visitor landing ships to the browser (#999 C56, #954; ADR 0026).
 *
 * Turbopack's production chunks carry no module paths, so the reachable client graph is rebuilt from the
 * build's own client reference manifest: its `clientModules` are the `"use client"` boundaries the route
 * renders; from each one every static and dynamic import is followed through the source (dependency-cruiser
 * resolves the `@/` alias, workspace packages and `exports`). Type-only imports are erased and a
 * `"use server"` module reaches the browser only as an action reference, so neither is followed.
 * The first-load chunks are scanned too, for runtime fingerprints of zod and of the Socket.IO client.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { firstLoadFiles } from "./bundle-budget";

/** Modules the visitor landing must never ship (C56): the lobby store, the race socket, zod. */
export const FORBIDDEN: { name: string; path: RegExp }[] = [
  { name: "lobby-store", path: /^src\/features\/lobby\/components\/lobby-store\.tsx?$/ },
  { name: "race/client/socket", path: /^src\/features\/race\/client\/socket\.tsx?$/ },
  { name: "zod", path: /(^|\/)node_modules\/zod\// },
  { name: "socket.io-client", path: /(^|\/)node_modules\/(socket\.io-client|engine\.io-client)\// },
];

/** Runtime fingerprints in minified chunks: zod v4's class names, engine.io's protocol query. */
export const CHUNK_FINGERPRINTS: { name: string; re: RegExp }[] = [
  { name: "zod", re: /\$Zod(Type|Object|String|Error)\b|\bZodError\b/ },
  { name: "socket.io-client", re: /\.EIO=\d/ },
];

/** The `"use client"` source modules a route's production client manifest lists (relative paths). */
export function clientBoundaries(distDir: string, route: string): string[] {
  const segments = route.split("/").filter(Boolean);
  const file = path.join(distDir, "server/app", ...segments, "page_client-reference-manifest.js");
  if (!fs.existsSync(file)) throw new Error(`no client manifest for ${route} (${file})`);
  const sandbox: { __RSC_MANIFEST?: Record<string, { clientModules?: Record<string, unknown> }> } =
    {};
  vm.runInNewContext(fs.readFileSync(file, "utf8"), { globalThis: sandbox }, { timeout: 1000 });
  const manifests = Object.values(sandbox.__RSC_MANIFEST ?? {});
  if (manifests.length !== 1) throw new Error(`expected one manifest in ${file}`);
  return [
    ...new Set(
      Object.keys(manifests[0]!.clientModules ?? {})
        .map((k) => k.split("#")[0]!.replace(/^\[project\]\//, ""))
        .filter((k) => /^(src|packages)\//.test(k)),
    ),
  ].sort();
}

const USE_SERVER = /^(?:\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/))*\s*["']use server["']/;

type Dep = { resolved: string; dependencyTypes: string[]; coreModule?: boolean };
type Mod = { source: string; dependencies: Dep[] };

/**
 * Every module the browser can load from these boundaries, each mapped to the module that imported it
 * (`null` for a boundary), so a finding can print its import chain.
 */
export async function clientGraph(
  roots: string[],
  cwd = process.cwd(),
): Promise<Map<string, string | null>> {
  const { cruise } = await import("dependency-cruiser"); // ESM only: loaded lazily from CommonJS
  const result = await cruise(roots, {
    baseDir: cwd,
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["browser", "import", "default", "types"],
      mainFields: ["browser", "module", "main", "types"],
    },
  });
  if (typeof result.output === "string") throw new Error("dependency-cruiser returned text");
  const modules = new Map<string, Mod>((result.output.modules as Mod[]).map((m) => [m.source, m]));
  const parent = new Map<string, string | null>();
  const queue: [string, string | null][] = roots.map((r) => [r, null]);
  while (queue.length > 0) {
    const [name, from] = queue.shift()!;
    if (parent.has(name)) continue;
    parent.set(name, from);
    const mod = modules.get(name);
    if (!mod || name.includes("node_modules/")) continue;
    const file = path.join(cwd, name);
    if (from !== null && fs.existsSync(file) && USE_SERVER.test(fs.readFileSync(file, "utf8")))
      continue; // a server action: the browser gets a reference, not the module
    for (const dep of mod.dependencies) {
      if (dep.coreModule) continue;
      if (dep.dependencyTypes.includes("type-only")) continue; // `import type`; "type-import" is a mixed one
      queue.push([dep.resolved, name]);
    }
  }
  return parent;
}

export function chain(graph: Map<string, string | null>, name: string): string {
  const links = [name];
  for (let at = graph.get(name); at; at = graph.get(at)) links.unshift(at);
  return links.join(" > ");
}

/** The forbidden modules reachable in a client graph, as `name: a > b > c` lines. */
export function forbiddenIn(graph: Map<string, string | null>): string[] {
  return [...graph.keys()].flatMap((m) =>
    FORBIDDEN.filter((f) => f.path.test(m)).map((f) => `${f.name}: ${chain(graph, m)}`),
  );
}

/** Fingerprints of forbidden runtimes found in a route's first-load chunks, as `name in file`. */
export function fingerprintsIn(distDir: string, route: string): string[] {
  return firstLoadFiles(distDir, route).flatMap((f) => {
    const text = fs.readFileSync(path.join(distDir, f), "utf8");
    return CHUNK_FINGERPRINTS.filter((p) => p.re.test(text)).map((p) => `${p.name} in ${f}`);
  });
}
