import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const original = { ...process.env };
const secret = "a".repeat(32);
beforeEach(() => {
  process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/db";
  process.env.RACE_TOKEN_SECRET = secret;
});
afterEach(() => {
  process.env = { ...original };
  vi.resetModules();
});

describe("env", () => {
  it("parses valid variables", async () => {
    process.env.RACE_SERVER_INTERNAL_URL = "http://race.internal:4000";
    process.env.NEXT_PUBLIC_RACE_SERVER_URL = "https://race.example.com";
    const { env } = await import("./env");
    expect(env.DATABASE_URL).toBe("postgresql://u:p@localhost:5432/db");
    expect(env.NEXT_PUBLIC_APP_URL).toBe(
      process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    );
    expect(env.RACE_TOKEN_SECRET).toBe(secret);
    expect(env.RACE_SERVER_INTERNAL_URL).toBe("http://race.internal:4000");
    expect(env.NEXT_PUBLIC_RACE_SERVER_URL).toBe("https://race.example.com");
  });

  it("fails fast naming the variable, without printing its value", async () => {
    process.env.DATABASE_URL = "not a url secret-value";
    await expect(import("./env")).rejects.toThrow(/DATABASE_URL/);
    await expect(import("./env")).rejects.not.toThrow(/secret-value/);
  });

  it("requires RACE_TOKEN_SECRET", async () => {
    delete process.env.RACE_TOKEN_SECRET;
    await expect(import("./env")).rejects.toThrow(/RACE_TOKEN_SECRET/);
  });

  it("rejects a short RACE_TOKEN_SECRET without printing it", async () => {
    process.env.RACE_TOKEN_SECRET = "short-secret-value";
    await expect(import("./env")).rejects.toThrow(/RACE_TOKEN_SECRET/);
    await expect(import("./env")).rejects.not.toThrow(/short-secret-value/);
  });

  it.each(["RACE_SERVER_INTERNAL_URL", "NEXT_PUBLIC_RACE_SERVER_URL"])(
    "rejects a non-url %s",
    async (name) => {
      process.env[name] = "nope";
      await expect(import("./env")).rejects.toThrow(new RegExp(name));
    },
  );
});
