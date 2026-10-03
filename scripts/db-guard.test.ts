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

  // URL parsers (pg-connection-string, Prisma) let query keys override the target and take the
  // host after the LAST "@" of the authority, so the guard must fail closed on both.
  it.each([
    "postgresql://u:hunter2@localhost:5432/db?host=db.prod.example.com",
    "postgresql://u:hunter2@localhost:5432/db?hostaddr=203.0.113.7",
    "postgresql://u:hunter2@localhost:5432/db?port=5999",
    "postgresql://u:hunter2@localhost:5432/db?schema=public&host=db.prod.example.com",
    "postgresql://u:hunter2@localhost:5432/db?HOST=db.prod.example.com",
    "postgresql://u:hunter2@localhost:5432/db?h%6Fst=db.prod.example.com",
    "postgresql://u:hunter2@localhost:5432/db?service=prod",
    "postgresql://u:hunter2@localhost:5432/db?dbname=postgresql://db.prod.example.com/db",
    "postgresql://u:hunter2@localhost:5432@db.prod.example.com/db",
    "postgresql://u:hunter2@localhost@db.prod.example.com:5432/db",
  ])("refuses target override %s without printing credentials", (url) => {
    const r = guard(url);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).not.toContain("hunter2");
  });

  it("does not print query values when refusing", () => {
    const r = guard("postgresql://u:p@localhost/db?password=hunter2&host=db.prod.example.com");
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).not.toContain("hunter2");
  });

  it("accepts harmless query parameters on a local host", () => {
    expect(
      guard("postgresql://app:app@localhost:5432/app?schema=public&sslmode=disable").status,
    ).toBe(0);
  });

  it("accepts designated test hosts", () => {
    expect(guard("postgresql://u:p@postgres:5432/db", "postgres,ci-db").status).toBe(0);
  });
});
