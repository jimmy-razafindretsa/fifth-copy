/**
 * Colour coverage of screenshots against the bible 3.1 target (#15; docs/design/components.md
 * "Colour usage rules", Coverage). Advisory: exit 0 unless --strict and a file warns.
 *   npx tsx scripts/colour-coverage.ts [--strict] <png...>
 * One line per file: `<file> paper NN% red NN% ink NN% violet NN% gold NN% other NN%` plus `WARN <role>`.
 * A file whose name contains `dark` is a Night shift screenshot (night-ink and night-muted count as ink).
 * Decoding uses sharp, already a dependency (avatar uploads); brand values come from tokens.css.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";
import type { Rgb } from "../src/lib/color";
import {
  candidates,
  formatLine,
  parseBrand,
  summarize,
  warn,
  type Shares,
} from "./lib/colour-coverage";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function measure(file: string, brand: Record<string, Rgb>): Promise<Shares> {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const dark = path.basename(file).includes("dark");
  return summarize(data, info.channels, candidates(brand, dark));
}

async function main() {
  const args = process.argv.slice(2);
  const strict = args.includes("--strict");
  const files = args.filter((a) => a !== "--strict");
  if (!files.length) {
    console.error("usage: npx tsx scripts/colour-coverage.ts [--strict] <png...>");
    process.exit(2);
  }
  const brand = parseBrand(fs.readFileSync(path.join(root, "docs/design/tokens.css"), "utf8"));
  let warned = 0;
  for (const file of files) {
    const shares = await measure(file, brand);
    if (warn(shares).length) warned++;
    console.log(formatLine(file, shares));
  }
  process.exit(strict && warned ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: unknown) => {
    console.error(`colour-coverage: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  });
}
