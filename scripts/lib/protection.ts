import { readFileSync } from "node:fs";
import path from "node:path";

// Desired protection for main (card #8), in the body shape of PUT .../branches/main/protection.
// Not applied: the private free-plan repo has no branch protection; scripts/merge.sh is the gate.
export const DESIRED_PATH = path.resolve(__dirname, "../../.github/branch-protection.json");

export type Desired = {
  required_status_checks: { strict: boolean; contexts: string[] };
  required_pull_request_reviews: null;
};
export type Live = {
  required_status_checks?: { strict?: boolean; contexts?: string[] };
} | null;

export const loadDesired = (): Desired => JSON.parse(readFileSync(DESIRED_PATH, "utf8")) as Desired;

/** Differences between the desired and live settings; empty when main is protected as desired. */
export function protectionDrift(desired: Desired, live: Live): string[] {
  if (!live) return ["main is not protected"];
  const drift: string[] = [];
  const have = new Set(live.required_status_checks?.contexts ?? []);
  const missing = desired.required_status_checks.contexts.filter((c) => !have.has(c));
  if (missing.length) drift.push(`required checks missing: ${missing.join(", ")}`);
  if (desired.required_status_checks.strict && !live.required_status_checks?.strict)
    drift.push("branches are not required to be up to date before merging");
  return drift;
}
