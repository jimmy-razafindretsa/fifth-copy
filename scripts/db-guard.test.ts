import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const guard = (url: string, allowed = "") =>
  spawnSync("scripts/db-guard.sh", [url], {
    env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", DB_GUARD_ALLOWED_HOSTS: allowed },
    encoding: "utf8",
  });

// The .env fallback: no URL argument, no DATABASE_URL in the env, .env read from the cwd.
const guardWithDotenv = (dotenv: string) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "db-guard-"));
  try {
    fs.writeFileSync(path.join(dir, ".env"), dotenv);
    return spawnSync(path.resolve(__dirname, "db-guard.sh"), [], {
      cwd: dir,
      env: { NODE_ENV: "test", PATH: process.env.PATH ?? "" },
      encoding: "utf8",
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

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

  // libpq-style multi-host authorities and percent-encoded hosts: refuse before any host compare.
  it.each([
    "postgresql://u:hunter2@localhost:5432,db.prod.example.com:5432/db",
    "postgresql://u:hunter2@localhost,db.prod.example.com/db",
    "postgresql://u:hunter2@[::1]:5432,db.prod.example.com:5432/db",
    "postgresql://u:hunter2@db.prod.example.com:5432,localhost:5432/db",
    "postgresql://u:hunter2@localhost%2Cdb.prod.example.com/db",
  ])("refuses multi-host or encoded authority %s without printing credentials", (url) => {
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

  it.each([
    "postgresql://u:p,q@localhost/db",
    "postgresql://app:app@localhost:5432/app?schema=public&application_name=a,b",
  ])("accepts commas outside the host part %s", (url) => {
    expect(guard(url).status).toBe(0);
  });

  it("accepts designated test hosts", () => {
    expect(guard("postgresql://u:p@postgres:5432/db", "postgres,ci-db").status).toBe(0);
  });

  it.each([
    ["postgres, ci-db", "postgresql://u:p@ci-db:5432/db"],
    [" postgres ,ci-db ", "postgresql://u:p@postgres:5432/db"],
    [" postgres ,ci-db ", "postgresql://u:p@ci-db/db"],
    ["postgres,\tci-db", "postgresql://u:p@ci-db:5432/db"],
  ])("ignores spaces and tabs around allowed host entries (%j, %s)", (allowed, url) => {
    expect(guard(url, allowed).status).toBe(0);
  });

  it.each(["postgres, ,ci-db", " "])(
    "never matches an empty host with an empty or blank entry (%j)",
    (allowed) => {
      expect(guard("postgresql://u:p@:5432/db", allowed).status).toBe(1);
    },
  );

  it("refuses remote hosts with only blank entries, without printing credentials", () => {
    const r = guard("postgresql://u:hunter2@db.prod.example.com/db", ", ");
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).not.toContain("hunter2");
  });

  describe(".env fallback (dotenv semantics)", () => {
    it.each([
      'export DATABASE_URL="postgresql://u:p@localhost:5432/db"',
      "DATABASE_URL=postgresql://u:p@localhost:5432/db",
      "DATABASE_URL='postgresql://u:p@localhost:5432/db'",
      'DATABASE_URL="postgresql://u:p@localhost:5432/db"',
      "DATABASE_URL=`postgresql://u:p@localhost:5432/db`",
      '  DATABASE_URL = "postgresql://u:p@localhost:5432/db"',
      "DATABASE_URL=postgresql://u:p@localhost:5432/db\r",
    ])("accepts %j", (line) => {
      const r = guardWithDotenv(`${line}\n`);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("host=localhost");
    });

    it.each([
      "DATABASE_URL=postgresql://u:hunter2@db.prod.example.com:5432/db",
      "export DATABASE_URL='postgresql://u:hunter2@db.prod.example.com:5432/db'",
    ])("refuses remote %j without printing credentials", (line) => {
      const r = guardWithDotenv(`${line}\n`);
      expect(r.status).toBe(1);
      expect(r.stdout + r.stderr).not.toContain("hunter2");
    });

    it("ignores a commented-out line", () => {
      const r = guardWithDotenv('# DATABASE_URL="postgresql://u:p@localhost:5432/db"\n');
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("not set");
    });

    // dotenv.parse keeps the LAST value of a repeated key (dotenv 18.0.5), and that is the URL
    // Prisma connects to, so the guard must judge the last one.
    it("judges the last definition of a repeated key, as dotenv does", () => {
      const r = guardWithDotenv(
        "DATABASE_URL=postgresql://u:p@localhost:5432/db\n" +
          "DATABASE_URL=postgresql://u:hunter2@db.prod.example.com/db\n",
      );
      expect(r.status).toBe(1);
      expect(r.stdout + r.stderr).not.toContain("hunter2");
      expect(
        guardWithDotenv(
          "DATABASE_URL=postgresql://u:hunter2@db.prod.example.com/db\n" +
            "DATABASE_URL=postgresql://u:p@localhost:5432/db\n",
        ).status,
      ).toBe(0);
    });

    it("does not match a key that only ends with DATABASE_URL", () => {
      const r = guardWithDotenv("TEST_DATABASE_URL=postgresql://u:p@localhost:5432/db\n");
      expect(r.status).toBe(2);
    });
  });
});
