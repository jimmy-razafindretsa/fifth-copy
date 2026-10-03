// Bundles the race server with esbuild (docs/adr/0005-monorepo-workspaces.md).
// Workspace packages (@fifth-copy/*) are bundled from TypeScript source; npm dependencies stay external.
import { build } from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const external = Object.keys(pkg.dependencies ?? {}).filter((d) => !d.startsWith("@fifth-copy/"));

await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.js",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  sourcemap: true,
  external,
  logLevel: "info",
});
