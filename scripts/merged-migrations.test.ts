import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Card #8 C3: editing a merged migration fails CI. The CI step "Merged migrations are immutable"
// runs scripts/merged-migrations.sh against the base branch; here the base is a local branch.
const script = path.resolve(__dirname, "merged-migrations.sh");
const migration = "prisma/migrations/20261001000000_init/migration.sql";
let repo = "";
// Every child carries its own deadline (#600), well below the slow project's per-test timeout
// (vitest.config.ts): a hung git or script fails with its own error, not the runner's.
const SPAWN_TIMEOUT = 15_000;
const run = (command: string, args: string[], env?: NodeJS.ProcessEnv) => {
  const r = spawnSync(command, args, { cwd: repo, encoding: "utf8", env, timeout: SPAWN_TIMEOUT });
  if (r.error) throw r.error;
  return r;
};

const git = (...args: string[]) =>
  run("git", args, { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" });
const write = (rel: string, body: string) => {
  mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  writeFileSync(path.join(repo, rel), body);
};
const commit = (msg: string) => {
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", msg);
};
const check = () => run(script, ["base"]);

beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), "merged-migrations-"));
  git("init", "-q", "-b", "base");
  write(migration, "CREATE TABLE a (id int);\n");
  commit("base");
  git("checkout", "-qb", "pr");
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("merged migrations are immutable (card #8 C3)", () => {
  it("passes when the PR only adds a new migration", () => {
    write("prisma/migrations/20261002000000_next/migration.sql", "CREATE TABLE b (id int);\n");
    commit("add");
    expect(check().status).toBe(0);
  });

  it("fails and names the file when a merged migration is edited", () => {
    write(migration, "CREATE TABLE a (id bigint);\n");
    commit("edit");
    const r = check();
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain(migration);
  });

  it("fails when a merged migration is deleted", () => {
    rmSync(path.join(repo, migration));
    commit("delete");
    expect(check().status).toBe(1);
  });

  it("fails when a merged migration is renamed", () => {
    mkdirSync(path.join(repo, "prisma/migrations/20261003000000_moved"));
    renameSync(
      path.join(repo, migration),
      path.join(repo, "prisma/migrations/20261003000000_moved/migration.sql"),
    );
    commit("rename");
    expect(check().status).toBe(1);
  });

  it("refuses to run without a base ref", () => {
    expect(run(script, []).status).toBe(2);
  });
});
