import { afterEach, describe, expect, it, vi } from "vitest";

const original = { ...process.env };
afterEach(() => {
  process.env = { ...original };
  vi.resetModules();
});

describe("env", () => {
  it("parses valid variables", async () => {
    process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/db";
    const { env } = await import("./env");
    expect(env.DATABASE_URL).toBe("postgresql://u:p@localhost:5432/db");
    expect(env.NEXT_PUBLIC_APP_URL).toBe(
      process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    );
  });

  it("fails fast naming the variable, without printing its value", async () => {
    process.env.DATABASE_URL = "not a url secret-value";
    await expect(import("./env")).rejects.toThrow(/DATABASE_URL/);
    await expect(import("./env")).rejects.not.toThrow(/secret-value/);
  });
});
