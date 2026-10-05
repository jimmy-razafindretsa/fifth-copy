import { afterEach, describe, expect, it, vi } from "vitest";

const original = { ...process.env };
afterEach(() => {
  process.env = { ...original };
  vi.resetModules();
});

describe("env", () => {
  it("parses valid variables", async () => {
    process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/db";
    process.env.AUTH_SECRET = "a".repeat(32);
    const { env } = await import("./env");
    expect(env.DATABASE_URL).toBe("postgresql://u:p@localhost:5432/db");
    expect(env.NEXT_PUBLIC_APP_URL).toBe(
      process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    );
  });

  it("fails fast naming the variable, without printing its value", async () => {
    process.env.DATABASE_URL = "not a url secret-value";
    process.env.AUTH_SECRET = "a".repeat(32);
    await expect(import("./env")).rejects.toThrow(/DATABASE_URL/);
    await expect(import("./env")).rejects.not.toThrow(/secret-value/);
  });

  it("requires AUTH_SECRET of at least 32 characters, without printing it", async () => {
    process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/db";
    process.env.AUTH_SECRET = "short-secret-value";
    await expect(import("./env")).rejects.toThrow(/AUTH_SECRET/);
    await expect(import("./env")).rejects.not.toThrow(/short-secret-value/);
    delete process.env.AUTH_SECRET;
    await expect(import("./env")).rejects.toThrow(/AUTH_SECRET/);
  });
});
