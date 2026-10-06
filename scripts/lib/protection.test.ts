import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { loadDesired, protectionDrift } from "./protection";

// Card #8 C2: the desired protection requires exactly the ci.yml jobs and no review.
// Not applied (private free-plan repo): scripts/merge.sh is the merge gate.
const root = path.resolve(__dirname, "../..");
const desired = loadDesired();
const ciJobs = parseYaml(readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8")) as {
  jobs: Record<string, { name?: string; strategy?: { matrix?: unknown } }>;
};

// Shape of GET repos/{owner}/{repo}/branches/main/protection.
const live = (contexts: string[], strict = true) => ({
  required_status_checks: { strict, contexts },
});

describe("branch protection for main (card #8 C2)", () => {
  it("lists exactly the ci.yml job names check, migrations, e2e, visual", () => {
    // Matrix jobs (the e2e shards, #532) are not checks of their own: a required job aggregates them.
    const names = Object.entries(ciJobs.jobs)
      .filter(([, job]) => job.strategy?.matrix === undefined)
      .map(([id, job]) => job.name ?? id);
    const contexts = [...desired.required_status_checks.contexts].sort();
    expect(contexts).toEqual(["check", "e2e", "migrations", "visual"]);
    expect(contexts).toEqual([...names].sort());
    expect(desired.required_status_checks.strict).toBe(true);
  });

  it("requires no review", () => {
    expect(desired.required_pull_request_reviews).toBeNull();
  });

  it("reports no drift when the live settings match", () => {
    expect(protectionDrift(desired, live(["visual", "e2e", "migrations", "check"]))).toEqual([]);
  });

  it("reports an unprotected branch", () => {
    expect(protectionDrift(desired, null)).toEqual(["main is not protected"]);
  });

  it("reports a missing check and a non-strict check", () => {
    const drift = protectionDrift(desired, live(["check", "e2e", "migrations"], false));
    expect(drift.join("\n")).toMatch(/visual/);
    expect(drift.join("\n")).toMatch(/up to date/);
  });
});
