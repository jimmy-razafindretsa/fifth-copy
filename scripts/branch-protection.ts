/**
 * Branch protection for main (card #8), desired state in .github/branch-protection.json.
 *   npx tsx scripts/branch-protection.ts            check: exit 0 when live matches, 1 with the drift
 *   npx tsx scripts/branch-protection.ts --apply    PUT the desired settings (a human runs this: admin, PROTOCOL 5a)
 * Branch protection on a private repo needs GitHub Pro (or a public repo); without it GitHub answers 403.
 */
import { spawnSync } from "node:child_process";
import { DESIRED_PATH, loadDesired, protectionDrift } from "./lib/protection";

const repo = process.env.BOARD_REPO ?? "jimmy-razafindretsa/fifth-copy";
const endpoint = `repos/${repo}/branches/main/protection`;
const gh = (...args: string[]) => spawnSync("gh", ["api", ...args], { encoding: "utf8" });

if (process.argv.includes("--apply")) {
  const r = gh("-X", "PUT", endpoint, "--input", DESIRED_PATH);
  if (r.status !== 0) {
    console.error(`branch-protection: PUT failed: ${(r.stdout + r.stderr).trim().slice(0, 300)}`);
    process.exit(1);
  }
}

const r = gh(endpoint);
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
