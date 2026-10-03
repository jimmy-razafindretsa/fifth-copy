/**
 * Negative tests for the import-boundary (C1, `npm run boundaries`) and env/import lint (C4, `npm run lint`)
 * gates of card #3: a clean tree passing proves little, so each rule is shown rejecting a deliberate violation.
 * The depcruise fixture tree is written to a temp dir (never under the repo, so tsc, eslint and prettier never see
 * it); lint probes use virtual file paths through ESLint's lintText.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ESLint } from "eslint";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repo = path.resolve(__dirname, "..");

// path -> source. Each "violation" file breaks exactly one rule; the rest are allowed imports.
const fixture: Record<string, string> = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: { module: "esnext", moduleResolution: "bundler" },
  }),
  "src/server/db.ts": "export const db = 1;\n",
  "src/features/stats/index.ts": 'export { q } from "./queries/q";\n',
  "src/features/stats/queries/q.ts": "export const q = 1;\n",
  "src/features/lobby/index.ts": 'export { a } from "./actions/a";\n',
  // allowed: another feature through its index.ts
  "src/features/lobby/actions/a.ts": 'import { q } from "../../stats";\nexport const a = q;\n',
  // allowed: Prisma in a feature job (ADR 0011, ARCHITECTURE section 5)
  "src/features/stats/jobs/rollup.ts":
    'import { PrismaClient } from "@prisma/client";\nexport const r = PrismaClient;\n',
  // violations
  "src/components/ui/button.ts": 'import { a } from "../../features/lobby";\nexport const b = a;\n',
  "src/lib/util.ts": 'import { db } from "../server/db";\nexport const u = db;\n',
  "src/features/lobby/actions/peek.ts":
    'import { q } from "../../stats/queries/q";\nexport const p = q;\n',
  "src/app/page.ts": 'import { q } from "../features/stats/queries/q";\nexport const page = q;\n',
  "src/features/stats/components/chart.ts":
    'import { PrismaClient } from "@prisma/client";\nexport const c = PrismaClient;\n',
  "packages/engine/src/index.ts": 'import { z } from "zod";\nexport const e = z;\n',
};

const expectedViolations = [
  "app-feature-public-api-only src/app/page.ts",
  "engine-is-pure packages/engine/src/index.ts",
  "feature-public-api-only src/features/lobby/actions/peek.ts",
  "lib-is-pure src/lib/util.ts",
  "prisma-only-in-server src/features/stats/components/chart.ts",
  "ui-no-features src/components/ui/button.ts",
];

type Violation = { rule: { name: string }; from: string };

describe("C1 boundaries gate rejects violations", () => {
  let dir = "";
  let violations: string[] = [];

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "gates-"));
    symlinkSync(path.join(repo, "node_modules"), path.join(dir, "node_modules"), "dir");
    for (const [file, src] of Object.entries(fixture)) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      writeFileSync(path.join(dir, file), src);
    }
    const r = spawnSync(
      path.join(repo, "node_modules/.bin/depcruise"),
      [
        "src",
        "packages",
        "--config",
        path.join(repo, ".dependency-cruiser.cjs"),
        "--output-type",
        "json",
      ],
      { cwd: dir, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    );
    const out = JSON.parse(r.stdout) as { summary: { violations: Violation[] } };
    violations = out.summary.violations.map((v) => `${v.rule.name} ${v.from}`).sort();
  }, 60_000);

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("reports exactly the deliberate violations, one rule each", () => {
    expect(violations).toEqual(expectedViolations);
  });

  it("allows Prisma in src/features/*/jobs (ADR 0011)", () => {
    expect(violations.filter((v) => v.includes("/jobs/"))).toEqual([]);
  });
});

describe("C4 lint gate rejects env and import violations", () => {
  const eslint = new ESLint({ cwd: repo });
  const lint = async (code: string, filePath: string) => {
    const [result] = await eslint.lintText(code, { filePath: path.join(repo, filePath) });
    return (result?.messages ?? []).filter((m) => m.severity === 2).map((m) => m.ruleId);
  };
  const envRead = "export const x = process.env.DATABASE_URL;\n";

  it.each([
    "src/features/lobby/actions/a.ts",
    "src/worker/main.ts",
    "services/race-server/src/room.ts",
  ])(
    "process.env in %s is an error",
    async (file) => {
      expect(await lint(envRead, file)).toContain("no-restricted-properties");
    },
    60_000,
  );

  it("src/env.ts may read process.env", async () => {
    expect(await lint(envRead, "src/env.ts")).toEqual([]);
  }, 60_000);

  it("src/components/ui importing @/server is an error", async () => {
    const code = 'import { db } from "@/server/db-client";\nexport const b = db;\n';
    expect(await lint(code, "src/components/ui/button.ts")).toContain("no-restricted-imports");
  }, 60_000);
});
