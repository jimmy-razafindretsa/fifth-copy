/**
 * Lists ADRs governing one or more paths.
 *   npx tsx scripts/adr-governing.ts <path> [path...]
 * Reads ADR files directly (so it is correct even if INDEX.json is stale) and warns when the index is stale.
 */
import fs from "node:fs";
import { INDEX_PATH, governing, loadAdrs, renderIndex } from "./lib/adr";

const targets = process.argv.slice(2).filter((a) => !a.startsWith("-"));
if (targets.length === 0) {
  console.error("usage: adr-governing <path> [path...]");
  process.exit(2);
}
const { adrs, errors } = loadAdrs();
if (errors.length)
  console.error(`warning: ${errors.length} ADR lint error(s); run npm run adr:index`);
if (!fs.existsSync(INDEX_PATH) || fs.readFileSync(INDEX_PATH, "utf8") !== renderIndex(adrs))
  console.error("warning: docs/adr/INDEX.json is stale; run npm run adr:index");

for (const t of targets) {
  const hits = governing(adrs, t);
  console.log(`${t}: ${hits.length ? "" : "no governing ADRs"}`);
  for (const { adr, warning } of hits) {
    console.log(`  ${adr.id} [${adr.status}] ${adr.title}`);
    console.log(`    rule: ${adr.rule}`);
    if (warning) console.log(`    ${warning}`);
  }
}
