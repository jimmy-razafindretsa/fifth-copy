/**
 * Colour usage guard (#15): fails when a source under src/ breaks a rule of docs/design/components.md
 * "Colour usage rules" (rules: scripts/lib/colour-rules.ts).
 *   npx tsx scripts/check-colours.ts [--root <dir>]   (check.sh step `colours`)
 * Prints `file:line rule` per violation, then `colours: N files, M violations`; exits 1 on any violation.
 * Extension point: OWNERSHIP below, mirrored in components.md. Add a path only when the design bible
 * mandates the usage there (cite the section in `why`).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isScanned, scan, type Ownership, type SourceFile } from "./lib/colour-rules";

export const OWNERSHIP: readonly Ownership[] = [
  {
    rule: "ink-ground",
    paths: [
      "src/app/design/**",
      "src/features/landing/components/sections.module.css",
      "src/components/ui/star.module.css",
    ],
    why: "/design shows every role as a swatch (#16 C6); bible 7.4 multi-cell grids gap 2px on an ink ground; bible 6 ink stars",
  },
  {
    rule: "reward",
    paths: [
      "src/features/results/**",
      "src/features/stats/**",
      "src/components/ui/**",
      "src/app/design/**",
      "src/features/landing/**",
      "src/features/preferences/**",
    ],
    why: "bible 3.1 rewards and bests; 7.1 social hover gold and 7.6 tag on the landing; the night dot of the theme toggle",
  },
  {
    rule: "device",
    paths: [
      "src/components/ui/device*.tsx",
      "src/features/race/**",
      "src/app/design/**",
      "src/features/lobby/components/lobby-entry.module.css",
    ],
    why: "bible 0 glow lives only in devices; lobby-entry: bible 7.1 inverted primary keeps its ink border and offset on the red band in both themes (device-bezel = press-ink; #595 moves it to the band role)",
  },
];

function walk(dir: string, root: string, out: string[]) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".worktrees") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, root, out);
    else out.push(path.relative(root, full).split(path.sep).join("/"));
  }
}

function main() {
  const flag = process.argv.indexOf("--root");
  const root = path.resolve(
    flag > 0
      ? (process.argv[flag + 1] ?? ".")
      : path.join(path.dirname(fileURLToPath(import.meta.url)), ".."),
  );
  const all: string[] = [];
  walk(path.join(root, "src"), root, all);
  const files: SourceFile[] = all
    .filter(isScanned)
    .sort()
    .map((p) => ({ path: p, text: fs.readFileSync(path.join(root, p), "utf8") }));
  const violations = scan(files, OWNERSHIP);
  for (const v of violations) console.log(`${v.file}:${v.line} ${v.rule}`);
  console.log(`colours: ${files.length} files, ${violations.length} violations`);
  process.exit(violations.length ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
