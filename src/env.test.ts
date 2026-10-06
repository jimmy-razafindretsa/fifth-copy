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

  it("parses valid variables", async () => {
    const env = await loadEnv({
      RACE_SERVER_INTERNAL_URL: "http://race.internal:4000",
      NEXT_PUBLIC_RACE_SERVER_URL: "https://race.example.com",
    });
    expect(env.DATABASE_URL).toBe(BASE.DATABASE_URL);
    expect(env.RACE_TOKEN_SECRET).toBe(BASE.RACE_TOKEN_SECRET);
    expect(env.RACE_SERVER_INTERNAL_URL).toBe("http://race.internal:4000");
    expect(env.NEXT_PUBLIC_RACE_SERVER_URL).toBe("https://race.example.com");
  });

  it("fails fast naming the variable, without printing its value", async () => {
    const error = await loadEnv({ DATABASE_URL: "not a url secret-value" }).catch((e: Error) => e);
    expect(String(error)).toMatch(/DATABASE_URL/);
    expect(String(error)).not.toMatch(/secret-value/);
  });

  it("requires AUTH_SECRET of at least 32 characters, without printing it", async () => {
    const error = await loadEnv({ AUTH_SECRET: "too-short-secret" }).catch((e: Error) => e);
    expect(String(error)).toMatch(/AUTH_SECRET/);
    expect(String(error)).not.toMatch(/too-short-secret/);
    await expect(loadEnv({ AUTH_SECRET: undefined })).rejects.toThrow(/AUTH_SECRET/);
  });

  it("requires RACE_TOKEN_SECRET", async () => {
    await expect(loadEnv({ RACE_TOKEN_SECRET: undefined })).rejects.toThrow(/RACE_TOKEN_SECRET/);
  });

  it("rejects a short RACE_TOKEN_SECRET without printing it", async () => {
    const error = await loadEnv({ RACE_TOKEN_SECRET: "short-secret-value" }).catch((e: Error) => e);
    expect(String(error)).toMatch(/RACE_TOKEN_SECRET/);
    expect(String(error)).not.toMatch(/short-secret-value/);
  });

  it.each(["RACE_SERVER_INTERNAL_URL", "NEXT_PUBLIC_RACE_SERVER_URL"])(
    "rejects a non-url %s",
    async (name) => {
      await expect(loadEnv({ [name]: "nope" })).rejects.toThrow(new RegExp(name));
    },
  );

  it("C6: AVATAR_DIR defaults to .data/avatars when unset", async () => {
    const env = await loadEnv({ AVATAR_DIR: undefined });
    expect(env.AVATAR_DIR).toBe(".data/avatars");
  });

  it("C6: AVATAR_DIR takes the configured directory", async () => {
    const env = await loadEnv({ AVATAR_DIR: "/data/avatars" });
    expect(env.AVATAR_DIR).toBe("/data/avatars");
  });

  it("C6: an empty AVATAR_DIR is rejected, naming the variable", async () => {
    await expect(loadEnv({ AVATAR_DIR: "" })).rejects.toThrow(/AVATAR_DIR/);
  });
});
