import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

// Card #423 C2: the uptime workflow runs scripts/deploy-smoke.sh against production every 15 min, retries a
// failed probe 3 times 20 s apart, and reads only public URLs from repository variables (no secret, no Railway).
type Step = {
  id?: string;
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
};
type Workflow = {
  on: Record<string, unknown>;
  concurrency: { group: string };
  permissions: Record<string, string>;
  jobs: Record<string, { env: Record<string, string>; steps: Step[]; "timeout-minutes"?: number }>;
};

const root = path.resolve(__dirname, "..");
const text = readFileSync(path.join(root, ".github/workflows/uptime.yml"), "utf8");
const wf = parseYaml(text) as Workflow;
const job = Object.values(wf.jobs)[0]!;
const smoke = job.steps.find((s) => s.run?.includes("deploy-smoke.sh"))!;

// Runs the smoke step in a scratch dir whose scripts/deploy-smoke.sh fails `failures` times, then passes.
const runStep = (failures: number) => {
  const dir = mkdtempSync(path.join(tmpdir(), "uptime-"));
  try {
    mkdirSync(path.join(dir, "scripts"));
    const stub = path.join(dir, "scripts/deploy-smoke.sh");
    writeFileSync(
      stub,
      `#!/bin/sh
n=$(cat count 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > count
echo "args=$1 race=$RACE_SMOKE_URL"
if [ "$n" -le ${failures} ]; then echo "FAIL health: GET /api/health -> 502 (want 200)"; exit 1; fi
echo "smoke: ok"
`,
    );
    chmodSync(stub, 0o755);
    const summary = path.join(dir, "summary.md");
    const r = spawnSync("bash", ["-e", "-c", smoke.run!], {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        WEB_PUBLIC_URL: "https://web.example",
        RACE_SERVER_PUBLIC_URL: "https://race.example",
        ATTEMPTS: job.env.ATTEMPTS,
        RETRY_SECONDS: "0",
        GITHUB_STEP_SUMMARY: summary,
      },
    });
    return {
      status: r.status,
      out: r.stdout + r.stderr,
      calls: Number(readFileSync(path.join(dir, "count"), "utf8")),
      summary: readFileSync(summary, "utf8"),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("uptime workflow (card #423)", () => {
  it("C2 runs every 15 min and on workflow_dispatch, with contents: read and a concurrency group", () => {
    expect(Object.keys(wf.on).sort()).toEqual(["schedule", "workflow_dispatch"]);
    expect(wf.on.schedule).toEqual([{ cron: "*/15 * * * *" }]);
    expect(wf.permissions).toEqual({ contents: "read" });
    expect(wf.concurrency.group).toBe("uptime");
    expect(job["timeout-minutes"]).toBeLessThanOrEqual(10);
  });

  it("C2 smokes the public web URL and the race server through deploy-smoke.sh, 3 attempts 20 s apart", () => {
    expect(Number(job.env.ATTEMPTS)).toBe(3);
    expect(Number(job.env.RETRY_SECONDS)).toBe(20);
    expect(smoke.run).toMatch(
      /RACE_SMOKE_URL="\$RACE_SERVER_PUBLIC_URL" scripts\/deploy-smoke\.sh "\$WEB_PUBLIC_URL"/,
    );
  });

  it("C2 a probe that recovers on the 3rd attempt ends green", () => {
    const r = runStep(2);
    expect(r.status).toBe(0);
    expect(r.calls).toBe(3);
    expect(r.out).toContain("args=https://web.example race=https://race.example");
    expect(r.summary).toContain("uptime: OK (attempt 3)");
  });

  it("C2 three failed attempts end red with the failing probe and the runbook section", () => {
    const r = runStep(3);
    expect(r.status).toBe(1);
    expect(r.calls).toBe(3);
    expect(r.out).toContain("::error::FAIL health: GET /api/health -> 502 (want 200)");
    expect(r.summary).toContain("uptime: DOWN after 3 attempts");
    expect(r.summary).toContain('section "Site down"');
  });

  it("C2 reads the public URLs from repository variables and names a missing one", () => {
    expect(job.env.WEB_PUBLIC_URL).toBe("${{ vars.WEB_PUBLIC_URL }}");
    expect(job.env.RACE_SERVER_PUBLIC_URL).toBe("${{ vars.RACE_SERVER_PUBLIC_URL }}");
    const guard = job.steps.find((s) => s.id === "vars")!;
    for (const name of ["WEB_PUBLIC_URL", "RACE_SERVER_PUBLIC_URL"]) {
      const env = {
        ...process.env,
        WEB_PUBLIC_URL: "https://w",
        RACE_SERVER_PUBLIC_URL: "https://r",
        [name]: "",
      };
      const r = spawnSync("bash", ["-c", guard.run!], { encoding: "utf8", env });
      expect(r.status).toBe(1);
      expect(r.stdout + r.stderr).toContain(name);
    }
  });

  it("C2 holds no secret, no Railway token and no Railway CLI", () => {
    expect(text).not.toMatch(/secrets\.|RAILWAY_TOKEN|railway /);
  });
});
