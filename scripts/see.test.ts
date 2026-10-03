import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Card #6 C3: see.ts refuses non-local hosts before launching a browser or writing .eyes/.
const ID = "see-test-refusal";
const see = (args: string[], env: Record<string, string> = {}) =>
  spawnSync(path.resolve("node_modules/.bin/tsx"), ["scripts/see.ts", ID, "/", ...args], {
    env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", ...env },
    encoding: "utf8",
    timeout: 30_000,
  });

describe("see.ts host allowlist", () => {
  it.each([
    "https://example.com",
    "http://localhost.evil.com:3000",
    "http://localhost@evil.com",
    "http://127.0.0.1.nip.io",
  ])("refuses --base %s without writing .eyes", (base) => {
    const r = see(["--base", base]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("refusing");
    expect(fs.existsSync(path.join(".eyes", ID))).toBe(false);
  });

  it("refuses a non-local SEE_BASE_URL", () => {
    const r = see([], { SEE_BASE_URL: "https://example.com" });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("refusing");
  });
});
