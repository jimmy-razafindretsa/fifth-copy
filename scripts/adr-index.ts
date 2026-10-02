/**
 * Generates docs/adr/INDEX.json from ADR frontmatter, and lints ADRs.
 *   npx tsx scripts/adr-index.ts          write the index
 *   npx tsx scripts/adr-index.ts --check  exit 1 if invalid or the index is stale (CI / check.sh)
 */
import fs from "node:fs";
import { INDEX_PATH, loadAdrs, renderIndex } from "./lib/adr";

const check = process.argv.includes("--check");
const { adrs, errors } = loadAdrs();
if (errors.length) {
  for (const e of errors.slice(0, 15)) console.error(`adr-lint: ${e}`);
  process.exit(1);
}
const next = renderIndex(adrs);
const current = fs.existsSync(INDEX_PATH) ? fs.readFileSync(INDEX_PATH, "utf8") : "";
if (check) {
  if (current !== next) {
    console.error("adr-index: INDEX.json is stale. Run `npm run adr:index` and commit it.");
    process.exit(1);
  }
  console.log(`adr-index: ok (${adrs.length} ADRs)`);
} else {
  fs.writeFileSync(INDEX_PATH, next);
  console.log(`adr-index: wrote ${INDEX_PATH} (${adrs.length} ADRs)`);
}
