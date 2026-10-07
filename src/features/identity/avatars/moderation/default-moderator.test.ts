import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// C6: AVATAR_MODERATOR selects the moderator (src/env.ts); `fake` is refused in production.
// src/env.ts parses process.env at import time, so each case stubs the variables and re-imports.
const BASE = {
  DATABASE_URL: "postgresql://app:app@localhost:5432/app",
  AUTH_SECRET: "a".repeat(32),
  RACE_TOKEN_SECRET: "r".repeat(32),
};

async function load(vars: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries({ ...BASE, ...vars })) vi.stubEnv(name, value);
  vi.resetModules();
  const { env } = await import("@/env");
  const { avatarModerator } = await import("./default-moderator");
  const { heuristicModerator } = await import("./heuristic");
  const { fakeModerator } = await import("./fake");
  return { env, avatarModerator, heuristicModerator, fakeModerator };
}

describe("AVATAR_MODERATOR (C6)", () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => vi.unstubAllEnvs());

  it("defaults to the heuristic", async () => {
    const m = await load({ AVATAR_MODERATOR: undefined, NODE_ENV: "development" });
    expect(m.env.AVATAR_MODERATOR).toBe("heuristic");
    expect(m.avatarModerator()).toBe(m.heuristicModerator);
  });

  it("defaults to the heuristic in production too", async () => {
    const m = await load({ AVATAR_MODERATOR: undefined, NODE_ENV: "production" });
    expect(m.env.AVATAR_MODERATOR).toBe("heuristic");
    expect(m.avatarModerator()).toBe(m.heuristicModerator);
  });

  it.each(["development", "test"])("selects the fake with NODE_ENV=%s", async (nodeEnv) => {
    const m = await load({ AVATAR_MODERATOR: "fake", NODE_ENV: nodeEnv });
    expect(m.env.AVATAR_MODERATOR).toBe("fake");
    expect(m.avatarModerator()).toBe(m.fakeModerator);
  });

  it("refuses the fake in production, naming the variable", async () => {
    await expect(load({ AVATAR_MODERATOR: "fake", NODE_ENV: "production" })).rejects.toThrow(
      /AVATAR_MODERATOR/,
    );
  });

  it.each(["FAKE", "fake ", "none", "approve", ""])("refuses the value %j", async (value) => {
    await expect(load({ AVATAR_MODERATOR: value, NODE_ENV: "development" })).rejects.toThrow(
      /AVATAR_MODERATOR/,
    );
  });
});
