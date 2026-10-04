import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";

// Card #449: prisma.config.ts must load without DATABASE_URL (fresh worktrees, CI check job),
// and DB commands must still fail fast without inventing a host.
const noDbEnv = () => {
  const env: NodeJS.ProcessEnv = { ...process.env, DOTENV_CONFIG_PATH: "/nonexistent" };
  delete env.DATABASE_URL;
  return env;
};

const prisma = (...args: string[]) =>
  spawnSync("npx", ["prisma", ...args], { env: noDbEnv(), encoding: "utf8", timeout: 60_000 });

describe("prisma CLI without DATABASE_URL", () => {
  it("C1 validate passes", () => {
    const r = prisma("validate");
    expect(r.stdout + r.stderr).not.toContain("PrismaConfigEnvError");
    expect(r.status).toBe(0);
  }, 60_000);

  it("C2 generate passes", () => {
    const r = prisma("generate");
    expect(r.stdout + r.stderr).not.toContain("PrismaConfigEnvError");
    expect(r.status).toBe(0);
  }, 60_000);

  it("C3 migrate status fails fast, names the missing config and no host", () => {
    const r = prisma("migrate", "status");
    const out = r.stdout + r.stderr;
    expect(r.status).not.toBe(0);
    expect(out).not.toContain("PrismaConfigEnvError");
    expect(out).toMatch(/datasource\.url|DATABASE_URL/);
    expect(out).not.toMatch(/postgres(ql)?:\/\//);
  }, 60_000);
});

describe("prisma.config.ts datasource", () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
    vi.resetModules();
  });

  it("C4 uses DATABASE_URL unchanged when set", async () => {
    const url = "postgresql://u:p@localhost:5432/db?schema=public";
    process.env = { ...noDbEnv(), DATABASE_URL: url };
    const { default: config } = await import("../prisma.config");
    expect(config.datasource?.url).toBe(url);
  });

  it("declares no datasource (no placeholder URL) when DATABASE_URL is unset", async () => {
    process.env = noDbEnv();
    const { default: config } = await import("../prisma.config");
    expect(config.datasource).toBeUndefined();
  });
});
