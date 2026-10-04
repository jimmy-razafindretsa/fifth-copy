import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

// Card #453 / ADR 0003: CI prepares the test DB with scripts/test-db.sh, and only jobs with a
// Postgres service see a DATABASE_URL. Rules are written over "jobs with services.postgres" so the
// next database job inherits them; only `migrations` is named (it exercises the deploy path, ADR 0012).
type Step = { name?: string; run?: string; uses?: string };
type Job = { services?: Record<string, unknown>; env?: Record<string, string>; steps: Step[] };
type Workflow = { env?: Record<string, string>; jobs: Record<string, Job> };

const root = path.resolve(__dirname, "..");
const workflow = parseYaml(
  readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8"),
) as Workflow;
const jobs = Object.entries(workflow.jobs);
const withPostgres = jobs.filter(([, job]) => job.services?.postgres !== undefined);
const runs = (job: Job) => job.steps.map((s) => s.run ?? "");
const DEPLOY_PATH = "migrations";

describe("CI workflow prepares the test database (ADR 0003)", () => {
  it("has a migrations job and at least one other database job", () => {
    expect(withPostgres.map(([name]) => name)).toContain(DEPLOY_PATH);
    expect(withPostgres.length).toBeGreaterThan(1);
  });

  it.each(withPostgres.filter(([name]) => name !== DEPLOY_PATH))(
    "C1 %s prepares the DB with scripts/test-db.sh, not prisma migrate deploy",
    (_name, job) => {
      expect(runs(job)).toContain("scripts/test-db.sh");
      expect(runs(job).filter((r) => r.includes("prisma migrate deploy"))).toEqual([]);
      expect(job.env?.TEST_DATABASE_URL).toBeTruthy();
    },
  );

  it("C2 the workflow-level env defines no DATABASE_URL", () => {
    expect(workflow.env?.DATABASE_URL).toBeUndefined();
  });

  it.each(jobs)(
    "C2 %s defines DATABASE_URL if and only if it has a postgres service",
    (_name, job) => {
      expect(job.env?.DATABASE_URL !== undefined).toBe(job.services?.postgres !== undefined);
    },
  );

  it("C3 migrations keeps the production deploy path and does not use scripts/test-db.sh", () => {
    const job = workflow.jobs[DEPLOY_PATH];
    const all = runs(job).join("\n");
    expect(all).toContain("prisma migrate deploy");
    expect(all).toContain("prisma migrate status");
    expect(all).toContain("prisma migrate diff");
    expect(all).not.toContain("scripts/test-db.sh");
  });

  it("C4 scripts/test-db.sh refuses a non-local TEST_DATABASE_URL without printing it", () => {
    const r = spawnSync("scripts/test-db.sh", [], {
      cwd: root,
      env: {
        NODE_ENV: "test",
        PATH: process.env.PATH ?? "",
        TEST_DATABASE_URL: "postgresql://u:hunter2@db.prod.example.com/db",
      },
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).not.toContain("hunter2");
  }, 30_000);
});
