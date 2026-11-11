import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROTOCOL_VERSION } from "@fifth-copy/protocol";

// Card #718 C1: /api/health also names the commit it runs (Railway's RAILWAY_GIT_COMMIT_SHA, null
// elsewhere) and its PROTOCOL_VERSION, so the deploy-check workflow can spot a stale deploy.
const queryRaw = vi.fn();
const env: { RAILWAY_GIT_COMMIT_SHA?: string } = {};
vi.mock("@/server/db", () => ({ db: { $queryRaw: (...args: unknown[]) => queryRaw(...args) } }));
vi.mock("@/env", () => ({ env }));

const { getHealth } = await import("./get-health");
const SHA = "0123456789abcdef0123456789abcdef01234567";

describe("getHealth (#718 C1)", () => {
  beforeEach(() => {
    queryRaw.mockReset().mockResolvedValue([{ "?column?": 1 }]);
    delete env.RAILWAY_GIT_COMMIT_SHA;
  });

  it("answers exactly { ok, db, commit, protocol } with commit null when Railway set no commit", async () => {
    expect(await getHealth()).toEqual({
      ok: true,
      db: "up",
      commit: null,
      protocol: PROTOCOL_VERSION,
    });
  });

  it("carries RAILWAY_GIT_COMMIT_SHA as commit when set", async () => {
    env.RAILWAY_GIT_COMMIT_SHA = SHA;
    expect(await getHealth()).toEqual({
      ok: true,
      db: "up",
      commit: SHA,
      protocol: PROTOCOL_VERSION,
    });
  });

  it("keeps ok/db unchanged when the database is down, still naming commit and protocol", async () => {
    env.RAILWAY_GIT_COMMIT_SHA = SHA;
    queryRaw.mockRejectedValue(new Error("connection refused"));
    expect(await getHealth()).toEqual({
      ok: false,
      db: "down",
      commit: SHA,
      protocol: PROTOCOL_VERSION,
    });
  });
});
