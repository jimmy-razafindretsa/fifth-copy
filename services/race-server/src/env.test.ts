import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const valid = {
  REDIS_URL: "redis://localhost:6379/3",
  RACE_TOKEN_SECRET: "b".repeat(32),
};

describe("race-server env", () => {
  it("parses valid variables and applies defaults", () => {
    const env = parseEnv(valid);
    expect(env.REDIS_URL).toBe("redis://localhost:6379/3");
    expect(env.RACE_TOKEN_SECRET).toBe(valid.RACE_TOKEN_SECRET);
    expect(env.WEB_ORIGIN).toBe("http://localhost:3000");
    expect(env.RACE_SERVER_PORT).toBe(4000);
    expect(env.RACE_FAST_CLOCK).toBe("0");
  });

  it("reads RACE_FAST_CLOCK", () => {
    expect(parseEnv({ ...valid, RACE_FAST_CLOCK: "1" }).RACE_FAST_CLOCK).toBe("1");
  });

  it("reads WEB_ORIGIN", () => {
    expect(parseEnv({ ...valid, WEB_ORIGIN: "https://fifth.example" }).WEB_ORIGIN).toBe(
      "https://fifth.example",
    );
  });

  it.each([
    ["missing secret", { REDIS_URL: valid.REDIS_URL }, "RACE_TOKEN_SECRET"],
    ["short secret", { ...valid, RACE_TOKEN_SECRET: "short-secret-value" }, "RACE_TOKEN_SECRET"],
    ["missing redis", { RACE_TOKEN_SECRET: valid.RACE_TOKEN_SECRET }, "REDIS_URL"],
    ["bad redis", { ...valid, REDIS_URL: "nope" }, "REDIS_URL"],
    ["bad origin", { ...valid, WEB_ORIGIN: "nope" }, "WEB_ORIGIN"],
    ["bad fast clock", { ...valid, RACE_FAST_CLOCK: "yes" }, "RACE_FAST_CLOCK"],
  ])("fails on %s naming the variable only", (_, source, name) => {
    expect(() => parseEnv(source)).toThrow(new RegExp(name));
    expect(() => parseEnv(source)).not.toThrow(/short-secret-value|bbbbbbbb/);
  });
});
