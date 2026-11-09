// Bundles the worker (ADR 0011, #733) into dist/worker/main.mjs for `npm run start:worker`.
// App code (src/**, the generated Prisma client) is bundled from TypeScript; the web package's npm
// dependencies stay external and resolve from node_modules, so the worker adds no runtime dependency.
// `server-only` guards server modules from client bundles; the worker is server code, so it is
// resolved under the `react-server` condition (its empty export), as `dev:worker` does with tsx.
import { build } from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const external = Object.keys(pkg.dependencies ?? {})
  .filter((d) => d !== "server-only")
  .flatMap((d) => [d, `${d}/*`]);

await build({
  entryPoints: ["src/worker/main.ts"],
  outfile: "dist/worker/main.mjs",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  sourcemap: true,
  conditions: ["react-server"],
  tsconfig: "tsconfig.json",
  external,
  // Bundled CommonJS helpers may call require(); give the ESM bundle one.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: "warning",
});
console.log("build-worker: dist/worker/main.mjs");
