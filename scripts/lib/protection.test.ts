import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { loadDesired, protectionDrift } from "./protection";

// Card #8 C2: main requires check, migrations, e2e, visual and a CODEOWNERS review.
const root = path.resolve(__dirname, "../..");
const desired = loadDesired();
const ciJobs = parseYaml(readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8")) as {
  jobs: Record<string, { name?: string }>;
};

// Shape of GET repos/{owner}/{repo}/branches/main/protection.
const live = (contexts: string[], codeOwners: boolean, strict = true) => ({
  required_status_checks: { strict, contexts },
  required_pull_request_reviews: {
    require_code_owner_reviews: codeOwners,
    required_approving_review_count: 1,
  },
});

describe("branch protection for main (card #8 C2)", () => {
  it("requires exactly the four CI checks and a CODEOWNERS review", () => {
    expect([...desired.required_status_checks.contexts].sort()).toEqual([
      "check",
      "e2e",
      "migrations",
      "visual",
    ]);
    expect(desired.required_pull_request_reviews.require_code_owner_reviews).toBe(true);
  });

  it("every required context is the name of a job in ci.yml", () => {
    const names = Object.entries(ciJobs.jobs).map(([id, job]) => job.name ?? id);
    for (const c of desired.required_status_checks.contexts) expect(names).toContain(c);
  });

  it("reports no drift when the live settings match", () => {
    expect(protectionDrift(desired, live(["visual", "e2e", "migrations", "check"], true))).toEqual(
      [],
    );
  });

  it("reports an unprotected branch", () => {
    expect(protectionDrift(desired, null)).toEqual(["main is not protected"]);
  });

  it("reports a missing check, a disabled CODEOWNERS review and a non-strict check", () => {
    const drift = protectionDrift(desired, live(["check", "e2e", "migrations"], false, false));
    expect(drift.join("\n")).toMatch(/visual/);
    expect(drift.join("\n")).toMatch(/code owner/i);
    expect(drift.join("\n")).toMatch(/up to date/);
  });
});
