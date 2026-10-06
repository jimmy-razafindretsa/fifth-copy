import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// src/env.ts parses process.env at import time, so each case stubs the variables and re-imports it.
const BASE = {
  DATABASE_URL: "postgresql://app:app@localhost:5432/app",
  AUTH_SECRET: "a".repeat(32),
  RACE_TOKEN_SECRET: "r".repeat(32),
};

async function loadEnv(vars: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries({ ...BASE, ...vars })) vi.stubEnv(name, value);
  vi.resetModules();
  return (await import("./env")).env;
}

describe("env", () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => vi.unstubAllEnvs());

  it("C6: AVATAR_DIR defaults to .data/avatars when unset", async () => {
    const env = await loadEnv({ AVATAR_DIR: undefined });
    expect(env.AVATAR_DIR).toBe(".data/avatars");
  });

  it("C6: AVATAR_DIR takes the configured directory", async () => {
    const env = await loadEnv({ AVATAR_DIR: "/data/avatars" });
    expect(env.AVATAR_DIR).toBe("/data/avatars");
  });

  it("C6: an empty AVATAR_DIR is rejected, naming the variable and never its value", async () => {
    await expect(loadEnv({ AVATAR_DIR: "" })).rejects.toThrow(/AVATAR_DIR/);
  });

  it("names invalid variables without printing their values", async () => {
    const error = await loadEnv({ AUTH_SECRET: "too-short-secret" }).catch((e: Error) => e);
    expect(String(error)).toMatch(/AUTH_SECRET/);
    expect(String(error)).not.toMatch(/too-short-secret/);
  });
});
