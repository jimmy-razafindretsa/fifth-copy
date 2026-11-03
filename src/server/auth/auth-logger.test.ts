import { AuthError, CredentialsSignin } from "next-auth";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { logger } from "@/server/logger";
import { createAuthLogger } from "./auth-logger";

vi.mock("@/env", () => ({ env: { NODE_ENV: "test" } }));

const USERNAME = "ada-lovelace";
const PASSWORD = "correct horse battery";

/** Every console line written while the test runs, whatever the level. */
let lines: string[];
let spies: MockInstance[];

beforeEach(() => {
  lines = [];
  spies = (["debug", "info", "warn", "error", "log"] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    }),
  );
});
afterEach(() => spies.forEach((s) => s.mockRestore()));

const authLogger = createAuthLogger(logger);

/** Auth.js's MissingCSRF (not re-exported by next-auth): an AuthError whose class type names it. */
class MissingCSRF extends AuthError {
  static type = "MissingCSRF";
}

/** An Auth.js error the way its callback route raises it, with the submitted form attached. */
function withForm<E extends Error>(error: E): E {
  Object.assign(error, { cause: { body: { username: USERNAME, password: PASSWORD } } });
  return error;
}

describe("Auth.js logger", () => {
  it("logs a CredentialsSignin as one structured info line, without stack or input", () => {
    authLogger.error(withForm(new CredentialsSignin()));

    expect(lines).toHaveLength(1);
    const line = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(line).toEqual({
      level: "info",
      time: expect.any(String),
      msg: "auth.rejected",
      type: "CredentialsSignin",
      code: "credentials",
    });
    expect(lines[0]).not.toMatch(/\bat\s|\.ts:|\.js:/);
    expect(lines[0]).not.toContain(USERNAME);
    expect(lines[0]).not.toContain(PASSWORD);
  });

  it("logs a MissingCSRF the same way", () => {
    authLogger.error(new MissingCSRF("CSRF token was missing during an action callback"));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ level: "info", type: "MissingCSRF" });
    expect(lines[0]).not.toContain("stack");
  });

  it("keeps unexpected errors at error level, as JSON, without the submitted form", () => {
    const wrapped = new Error("Read more at https://errors.authjs.dev#callbackrouteerror");
    Object.assign(wrapped, {
      cause: { err: new TypeError("db down"), body: { username: USERNAME, password: PASSWORD } },
    });
    authLogger.error(wrapped);

    expect(lines).toHaveLength(1);
    const line = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(line).toMatchObject({ level: "error", msg: "auth.error", cause: "TypeError" });
    expect(line.stack).toContain("TypeError: db down");
    expect(lines[0]).not.toContain(USERNAME);
    expect(lines[0]).not.toContain(PASSWORD);
  });

  it("writes warnings as JSON and drops debug metadata (and debug lines outside development)", () => {
    authLogger.warn("debug-enabled");
    authLogger.debug("callback route error details", { body: { password: PASSWORD } });
    expect(lines.map((l) => JSON.parse(l) as unknown)).toEqual([
      { level: "warn", time: expect.any(String), msg: "auth.warn", code: "debug-enabled" },
    ]);
  });
});

describe("logger", () => {
  it("redacts secret-looking fields", () => {
    logger.warn("x", { password: PASSWORD, sessionToken: "t", type: "kept" });
    expect(JSON.parse(lines[0]!)).toMatchObject({
      password: "[redacted]",
      sessionToken: "[redacted]",
      type: "kept",
    });
  });
});
