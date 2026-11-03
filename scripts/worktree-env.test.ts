import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { unitRedisEnv } from "./lib/redis-env";

// #680: a card worktree's unit step and its e2e race server get distinct Redis dbs, and two live
// worktrees never share one. `scripts/worktree.sh --env <n>` prints the env with no side effects;
// WORKTREE_ROOT points it at a fixture checkout whose .worktrees/*/.env are the other cards.
const SCRIPT = path.resolve(__dirname, "worktree.sh");
let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "worktree-env-"));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const envFor = (n: number) =>
  spawnSync(SCRIPT, ["--env", String(n)], {
    env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", WORKTREE_ROOT: root },
    encoding: "utf8",
  });

const redisDbs = (out: string) => {
  const db = (name: string) => {
    const m = out.match(new RegExp(`^${name}="redis://localhost:6379/(\\d+)"$`, "m"));
    return m ? Number(m[1]) : undefined;
  };
  return { e2e: db("REDIS_URL"), unit: db("REDIS_URL_TEST") };
};

/** Writes card n's worktree .env into the fixture, as `scripts/worktree.sh <n>` would. */
const createWorktree = (n: number, dotenv?: string) => {
  if (dotenv === undefined) {
    const r = envFor(n);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    dotenv = r.stdout;
  }
  fs.mkdirSync(path.join(root, ".worktrees", String(n)), { recursive: true });
  fs.writeFileSync(path.join(root, ".worktrees", String(n), ".env"), dotenv);
  return redisDbs(dotenv);
};

describe("worktree.sh Redis dbs (#680)", () => {
  it.each([1, 14, 15, 629])("card %i: unit db differs from the e2e db, both in 1..15", (n) => {
    const r = envFor(n);
    expect(r.status, r.stderr).toBe(0);
    const { e2e, unit } = redisDbs(r.stdout);
    expect(e2e).toBeDefined();
    expect(unit).toBeDefined();
    expect(unit).not.toBe(e2e);
    for (const db of [e2e!, unit!]) {
      expect(db).toBeGreaterThanOrEqual(1);
      expect(db).toBeLessThanOrEqual(15);
    }
  });

  it.each([
    [629, 644],
    [1, 16],
    [629, 636], // 7 apart: same preferred pair, the second card falls back to free dbs
  ])("cards %i and %i never share a db", (a, b) => {
    const first = createWorktree(a);
    const second = createWorktree(b);
    const dbs = [first.e2e, first.unit, second.e2e, second.unit];
    expect(new Set(dbs).size).toBe(4);
  });

  it("a card keeps the dbs its existing .env holds", () => {
    createWorktree(629);
    const own = createWorktree(
      680,
      'REDIS_URL="redis://localhost:6379/11"\nREDIS_URL_TEST="redis://localhost:6379/12"\n',
    );
    expect(own).toEqual({ e2e: 11, unit: 12 });
    expect(redisDbs(envFor(680).stdout)).toEqual({ e2e: 11, unit: 12 });
  });

  it("old single-db worktrees count as taken", () => {
    // 629's preferred pair is 13/14; an older .env holding db 13 pushes it elsewhere.
    createWorktree(76, 'REDIS_URL="redis://localhost:6379/13"\n');
    const { e2e, unit } = redisDbs(envFor(629).stdout);
    expect([e2e, unit]).not.toContain(13);
  });

  it("refuses with exit 3 naming the other cards when every db is taken", () => {
    for (let db = 1; db <= 15; db++) {
      createWorktree(100 + db, `REDIS_URL="redis://localhost:6379/${db}"\n`);
    }
    const r = envFor(629);
    expect(r.status).toBe(3);
    expect(r.stdout + r.stderr).toMatch(/#101\b/);
    expect(r.stdout + r.stderr).toMatch(/--remove/);
  });
});

describe("unit step Redis mapping (#680)", () => {
  it("maps REDIS_URL_TEST onto REDIS_URL for the unit run", () => {
    expect(
      unitRedisEnv({
        REDIS_URL: "redis://localhost:6379/3",
        REDIS_URL_TEST: "redis://localhost:6379/4",
      }),
    ).toEqual({ REDIS_URL: "redis://localhost:6379/4" });
  });

  it("keeps REDIS_URL as is without a worktree (CI, main checkout)", () => {
    expect(unitRedisEnv({ REDIS_URL: "redis://localhost:6379/0" })).toEqual({});
    expect(unitRedisEnv({})).toEqual({});
  });

  it("the unit run sees the mapped URL", () => {
    if (process.env.REDIS_URL_TEST) expect(process.env.REDIS_URL).toBe(process.env.REDIS_URL_TEST);
  });
});
