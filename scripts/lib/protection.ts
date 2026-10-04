import { readFileSync } from "node:fs";
import path from "node:path";

// Desired protection for main (card #8), in the body shape of PUT .../branches/main/protection.
export const DESIRED_PATH = path.resolve(__dirname, "../../.github/branch-protection.json");

export type Desired = {
  required_status_checks: { strict: boolean; contexts: string[] };
  required_pull_request_reviews: {
    require_code_owner_reviews: boolean;
    required_approving_review_count: number;
  };
};
export type Live = {
  required_status_checks?: { strict?: boolean; contexts?: string[] };
  required_pull_request_reviews?: {
    require_code_owner_reviews?: boolean;
    required_approving_review_count?: number;
  };
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
  const reviews = live.required_pull_request_reviews;
  const want = desired.required_pull_request_reviews;
  if (want.require_code_owner_reviews && !reviews?.require_code_owner_reviews)
    drift.push("code owner review is not required");
  if ((reviews?.required_approving_review_count ?? 0) < want.required_approving_review_count)
    drift.push(`fewer than ${want.required_approving_review_count} approving review(s) required`);
  return drift;
}
