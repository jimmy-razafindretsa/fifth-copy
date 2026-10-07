import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

// Card #453 / ADR 0003: CI prepares the test DB with scripts/test-db.sh, and only jobs with a
// Postgres service see a DATABASE_URL. Rules are written over "jobs with services.postgres" so the
// next database job inherits them; only `migrations` is named (it exercises the deploy path, ADR 0012).
type Step = { name?: string; run?: string; uses?: string; if?: string };
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
    expect(job).toBeDefined();
    const all = runs(job ?? { steps: [] }).join("\n");
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

// Card #501: the job running the unit step (scripts/check.sh) runs the DB-backed Vitest suites
// (describe.skipIf(!TEST_DATABASE_URL)) against a real Postgres instead of skipping them. The job is
// located by its step, not its name, so a rename keeps the rule.
describe("CI unit step runs the DB-backed suites (card #501)", () => {
  const unit = jobs.find(([, job]) => runs(job).includes("scripts/check.sh"));

  it("C1 a job runs scripts/check.sh", () => {
    expect(unit).toBeDefined();
  });

  it("C1 it has a Postgres service and sets TEST_DATABASE_URL", () => {
    const job = unit?.[1];
    expect(job?.services?.postgres).toBeDefined();
    expect(job?.env?.TEST_DATABASE_URL).toBeTruthy();
  });

  it("C1 it prepares the test DB with scripts/test-db.sh before scripts/check.sh", () => {
    const steps = runs(unit?.[1] ?? { steps: [] });
    const prepare = steps.indexOf("scripts/test-db.sh");
    expect(prepare).toBeGreaterThanOrEqual(0);
    expect(prepare).toBeLessThan(steps.indexOf("scripts/check.sh"));
  });

  it("C2 it always prints the Vitest summary that check.sh keeps in its unit log", () => {
    const summary = (unit?.[1].steps ?? []).find((s) => s.run?.includes(".cache/check/unit.log"));
    expect(summary).toMatchObject({ if: "always()" });
  });
});

// Card #532: the e2e suite runs as a Playwright --shard matrix so each shard fits the time budget,
// while `e2e` stays ONE required check (.github/branch-protection.json, scripts/merge.sh): an
// aggregating job that needs every shard and passes only when all of them succeeded.
describe("CI e2e is sharded behind one required check (card #532)", () => {
  type MatrixJob = Job & {
    name?: string;
    needs?: string | string[];
    if?: string;
    "timeout-minutes"?: number;
    strategy?: { "fail-fast"?: boolean; matrix?: { shard?: number[]; shardTotal?: number[] } };
  };
  const all = workflow.jobs as Record<string, MatrixJob>;
  const required = (
    JSON.parse(readFileSync(path.join(root, ".github/branch-protection.json"), "utf8")) as {
      required_status_checks: { contexts: string[] };
    }
  ).required_status_checks.contexts;
  const shardIds = Object.keys(all).filter((id) => all[id]?.strategy?.matrix?.shard);
  const shardId = shardIds[0] ?? "";
  const shard = all[shardId];
  const gate = all.e2e;

  it("C2 every required check is a non-matrix job named exactly like it, e2e included", () => {
    expect(required).toContain("e2e");
    for (const context of required) {
      const job = Object.entries(all).find(([id, j]) => (j.name ?? id) === context)?.[1];
      expect(job, context).toBeDefined();
      expect(job?.strategy?.matrix, context).toBeUndefined();
    }
  });

  it("C2 the e2e check needs the shard job, always runs, and fails unless every shard succeeded", () => {
    expect(shardIds).toHaveLength(1);
    expect(gate?.name ?? "e2e").toBe("e2e");
    expect([gate?.needs].flat()).toContain(shardId);
    expect(gate?.if).toBe("always()");
    const run = runs(gate ?? { steps: [] }).join("\n");
    expect(run).toMatch(/= *"?success"?/);
    expect(JSON.stringify(gate?.steps)).toContain(`needs.${shardId}.result`);
  });

  it("C1 the shard matrix covers 1..N exactly and each shard runs its slice of the full suite", () => {
    const total = shard?.strategy?.matrix?.shardTotal ?? [];
    expect(total).toHaveLength(1);
    const n = total[0] ?? 0;
    expect(n).toBeGreaterThan(1);
    expect(shard?.strategy?.matrix?.shard).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    expect(shard?.strategy?.["fail-fast"]).toBe(false);
    const pw = runs(shard ?? { steps: [] }).filter((r) => r.includes("playwright test"));
    expect(pw).toEqual([
      "npx playwright test --shard=${{ matrix.shard }}/${{ matrix.shardTotal }}",
    ]);
    expect(shard?.["timeout-minutes"]).toBeLessThanOrEqual(15);
  });
});

// Card #543: a push to main never cancels (or evicts) the run of the previous merge commit, which is
// the run `board.ts gate <n> Done` checks. PR refs keep cancel-in-progress. The yaml parser returns
// `${{ ... }}` verbatim, so a test-only evaluator handles exactly the shapes the block uses: a bare
// `<ctx>`, `<ctx> (==|!=) '<lit>'` and `<ctx> == '<lit>' && <ctx> || <ctx>`. Anything else throws.
describe("CI concurrency never cancels a main run (card #543)", () => {
  type Ctx = Record<string, string>;
  type Concurrency = { group?: string; "cancel-in-progress"?: string | boolean };
  const block = (workflow as Workflow & { concurrency?: Concurrency }).concurrency;

  const value = (ctx: Ctx, token: string): string => {
    const lit = /^'([^']*)'$/.exec(token);
    if (lit) return lit[1] ?? "";
    if (!(token in ctx)) throw new Error(`unknown context ${token}`);
    return ctx[token] ?? "";
  };
  const expr = (ctx: Ctx, src: string): string | boolean => {
    const s = src.trim();
    if (/^[\w.]+$/.test(s)) return value(ctx, s);
    const cmp = /^(\S+) (==|!=) ('[^']*')$/.exec(s);
    if (cmp) return (value(ctx, cmp[1] ?? "") === value(ctx, cmp[3] ?? "")) === (cmp[2] === "==");
    const tern = /^(\S+) == ('[^']*') && (\S+) \|\| (\S+)$/.exec(s);
    if (tern) {
      const hit = value(ctx, tern[1] ?? "") === value(ctx, tern[2] ?? "");
      return value(ctx, (hit ? tern[3] : tern[4]) ?? "");
    }
    throw new Error(`unsupported expression: ${s}`);
  };
  const evaluate = (ctx: Ctx, raw: string | boolean | undefined): string | boolean => {
    if (typeof raw !== "string") return raw ?? "";
    const whole = /^\$\{\{(.*)\}\}$/.exec(raw.trim());
    if (whole) return expr(ctx, whole[1] ?? "");
    return raw.replace(/\$\{\{(.*?)\}\}/g, (_m, e: string) => String(expr(ctx, e)));
  };
  const at = (ref: string, sha: string) => {
    const ctx = { "github.ref": ref, "github.sha": sha };
    return {
      group: evaluate(ctx, block?.group),
      cancel: evaluate(ctx, block?.["cancel-in-progress"]),
    };
  };

  it("C1 a main push is never cancelled: cancel-in-progress is false on refs/heads/main", () => {
    expect(at("refs/heads/main", "aaa111").cancel).toBe(false);
  });

  it("C1 each main merge commit gets its own group, so a later push cannot evict it", () => {
    expect(at("refs/heads/main", "aaa111").group).toBe("ci-aaa111");
    expect(at("refs/heads/main", "bbb222").group).not.toBe(at("refs/heads/main", "aaa111").group);
  });

  it("C1 PR refs keep today's behaviour: group ci-<ref>, cancel-in-progress true", () => {
    expect(at("refs/pull/12/merge", "aaa111")).toEqual({
      group: "ci-refs/pull/12/merge",
      cancel: true,
    });
    expect(at("refs/pull/12/merge", "bbb222").group).toBe("ci-refs/pull/12/merge");
  });

  it("C1 no job overrides the workflow-level concurrency", () => {
    for (const [id, job] of jobs)
      expect((job as Job & { concurrency?: unknown }).concurrency, id).toBeUndefined();
  });
});
