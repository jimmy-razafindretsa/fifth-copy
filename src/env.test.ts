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

  it("REDIS_URL is an optional redis url outside production (#207): absent or empty disables the limiter", async () => {
    expect((await loadEnv({ REDIS_URL: "redis://localhost:6379/3" })).REDIS_URL).toBe(
      "redis://localhost:6379/3",
    );
    expect((await loadEnv({ REDIS_URL: undefined })).REDIS_URL).toBeUndefined();
    expect((await loadEnv({ REDIS_URL: "" })).REDIS_URL).toBeUndefined();
    const error = await loadEnv({ REDIS_URL: "http://secret-host:6379" }).catch((e: Error) => e);
    expect(String(error)).toMatch(/REDIS_URL/);
    expect(String(error)).not.toMatch(/secret-host/);
  });

  it("#716 C3: REDIS_URL is required in production (the nonce store fails closed), not in dev/test", async () => {
    for (const value of [undefined, ""]) {
      const error = await loadEnv({ NODE_ENV: "production", REDIS_URL: value }).catch(
        (e: Error) => e,
      );
      expect(String(error)).toMatch(/Invalid environment variables: REDIS_URL/);
    }
    const prod = await loadEnv({ NODE_ENV: "production", REDIS_URL: "redis://redis:6379/0" });
    expect(prod.REDIS_URL).toBe("redis://redis:6379/0");
    for (const NODE_ENV of ["development", "test"]) {
      expect((await loadEnv({ NODE_ENV, REDIS_URL: undefined })).REDIS_URL).toBeUndefined();
    }
  });

  it("#716: WEB_RATE_LIMIT is on by default and only on or off", async () => {
    expect((await loadEnv({ WEB_RATE_LIMIT: undefined })).WEB_RATE_LIMIT).toBe("on");
    expect((await loadEnv({ WEB_RATE_LIMIT: "off" })).WEB_RATE_LIMIT).toBe("off");
    await expect(loadEnv({ WEB_RATE_LIMIT: "no" })).rejects.toThrow(/WEB_RATE_LIMIT/);
  });

  it("#716: WEB_RATE_LIMIT=off is refused on a deployed production server", async () => {
    const prod = {
      NODE_ENV: "production",
      REDIS_URL: "redis://redis:6379/0",
      WEB_RATE_LIMIT: "off",
    };
    for (const extra of [{}, { CI: "true" }, { RAILWAY_ENVIRONMENT_NAME: "production" }]) {
      await expect(loadEnv({ ...prod, ...extra, PLAYWRIGHT_E2E: undefined })).rejects.toThrow(
        /Invalid environment variables: WEB_RATE_LIMIT/,
      );
    }
    await expect(loadEnv({ ...prod, PLAYWRIGHT_E2E: "true" })).rejects.toThrow(/PLAYWRIGHT_E2E/);
  });

  it("#716: WEB_RATE_LIMIT=off is allowed under Playwright (CI e2e) and in dev and test", async () => {
    const prod = await loadEnv({
      NODE_ENV: "production",
      REDIS_URL: "redis://redis:6379/0",
      WEB_RATE_LIMIT: "off",
      PLAYWRIGHT_E2E: "1",
      CI: "true",
    });
    expect(prod.WEB_RATE_LIMIT).toBe("off");
    for (const NODE_ENV of ["development", "test"]) {
      const env = await loadEnv({ NODE_ENV, WEB_RATE_LIMIT: "off", PLAYWRIGHT_E2E: undefined });
      expect(env.WEB_RATE_LIMIT).toBe("off");
    }
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
