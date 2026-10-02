import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const guard = (url: string, allowed = "") =>
  spawnSync("scripts/db-guard.sh", [url], {
    env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", DB_GUARD_ALLOWED_HOSTS: allowed },
    encoding: "utf8",
  });

describe("db-guard", () => {
  it.each([
    "postgresql://u:p@localhost:5432/db",
    "postgresql://u:p@127.0.0.1/db",
    "postgresql://u:p@[::1]:5432/db",
  ])("accepts local %s", (url) => {
    expect(guard(url).status).toBe(0);
  });

  it("refuses remote hosts without printing credentials", () => {
    const r = guard("postgresql://user:hunter2@db.prod.example.com:5432/db");
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).not.toContain("hunter2");
  });

  it("refuses a host that only starts with localhost", () => {
    expect(guard("postgresql://u:p@localhost.evil.com/db").status).toBe(1);
  });

  it("accepts designated test hosts", () => {
    expect(guard("postgresql://u:p@postgres:5432/db", "postgres,ci-db").status).toBe(0);
  });
});
