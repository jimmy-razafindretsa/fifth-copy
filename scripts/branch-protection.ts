/**
 * Report-only: compares live branch protection for main with .github/branch-protection.json (card #8).
 *   npx tsx scripts/branch-protection.ts    exit 0 when live matches, 1 with the drift, 2 when GET fails
 * Not part of CI. The repo is private on a free plan, so main has no branch protection and this reports
 * "main is not protected": scripts/merge.sh is the merge gate. The JSON is the exact PUT body if the plan
 * ever allows protection.
 */
import { spawnSync } from "node:child_process";
import { loadDesired, protectionDrift } from "./lib/protection";

const repo = process.env.BOARD_REPO ?? "jimmy-razafindretsa/fifth-copy";
const endpoint = `repos/${repo}/branches/main/protection`;

const r = spawnSync("gh", ["api", endpoint], { encoding: "utf8" });
let live = null;
if (r.status === 0) live = JSON.parse(r.stdout);
else if (!/Branch not protected/.test(r.stdout + r.stderr)) {
  console.error(`branch-protection: GET failed: ${(r.stdout + r.stderr).trim().slice(0, 300)}`);
  process.exit(2);
}
const drift = protectionDrift(loadDesired(), live);
if (drift.length) {
  for (const d of drift) console.log(`drift: ${d}`);
  process.exit(1);
}
console.log("branch-protection: main matches .github/branch-protection.json");
