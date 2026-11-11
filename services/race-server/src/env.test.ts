import { describe, expect, it } from "vitest";
import { DEFAULT_DRAIN_CAP_S, drainingTooShort, parseEnv } from "./env";

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
    expect(env.RACE_DRAIN_CAP_S).toBe(DEFAULT_DRAIN_CAP_S);
    expect(env.RAILWAY_DEPLOYMENT_DRAINING_SECONDS).toBeUndefined();
  });

  it("RACE_GRACE_MS (e2e only, #868): unset by default, an int in [1 s, 120 s] when set", () => {
    expect(parseEnv(valid).RACE_GRACE_MS).toBeUndefined();
    expect(parseEnv({ ...valid, RACE_GRACE_MS: "" }).RACE_GRACE_MS).toBeUndefined();
    expect(parseEnv({ ...valid, RACE_GRACE_MS: "20000" }).RACE_GRACE_MS).toBe(20_000);
    expect(() => parseEnv({ ...valid, RACE_GRACE_MS: "500" })).toThrow(/RACE_GRACE_MS/);
    expect(() => parseEnv({ ...valid, RACE_GRACE_MS: "999999" })).toThrow(/RACE_GRACE_MS/);
  });

  it("reads the drain cap and Railway's draining time (#704)", () => {
    const env = parseEnv({
      ...valid,
      RACE_DRAIN_CAP_S: "120",
      RAILWAY_DEPLOYMENT_DRAINING_SECONDS: "150",
    });
    expect(env.RACE_DRAIN_CAP_S).toBe(120);
    expect(env.RAILWAY_DEPLOYMENT_DRAINING_SECONDS).toBe(150);
  });

  it("flags a Railway draining time shorter than the drain cap (#704)", () => {
    expect(drainingTooShort(parseEnv(valid))).toBe(false);
    const cap = { ...valid, RACE_DRAIN_CAP_S: "900" };
    expect(drainingTooShort(parseEnv({ ...cap, RAILWAY_DEPLOYMENT_DRAINING_SECONDS: "930" }))).toBe(
      false,
    );
    expect(drainingTooShort(parseEnv({ ...cap, RAILWAY_DEPLOYMENT_DRAINING_SECONDS: "0" }))).toBe(
      true,
    );
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
    ["zero drain cap", { ...valid, RACE_DRAIN_CAP_S: "0" }, "RACE_DRAIN_CAP_S"],
    ["drain cap over an hour", { ...valid, RACE_DRAIN_CAP_S: "3601" }, "RACE_DRAIN_CAP_S"],
    [
      "bad draining time",
      { ...valid, RAILWAY_DEPLOYMENT_DRAINING_SECONDS: "-1" },
      "RAILWAY_DEPLOYMENT_DRAINING_SECONDS",
    ],
  ])("fails on %s naming the variable only", (_, source, name) => {
    expect(() => parseEnv(source)).toThrow(new RegExp(name));
    expect(() => parseEnv(source)).not.toThrow(/short-secret-value|bbbbbbbb/);
  });
});
