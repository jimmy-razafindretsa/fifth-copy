import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_DRAIN_CAP_S } from "../services/race-server/src/env";

// #704 C2: the race-server's Railway deploy settings, as config-as-code. Railway sends SIGTERM to
// the old deployment once the new one is healthy and SIGKILL `drainingSeconds` later (default 0);
// the race server drains for at most RACE_DRAIN_CAP_S, so the platform must wait longer than that.
// The same values are the service variables RAILWAY_DEPLOYMENT_DRAINING_SECONDS and
// RAILWAY_DEPLOYMENT_OVERLAP_SECONDS (ADR 0019 Consequences; Config as Code files stop being read
// on 2026-12-01).

const config = JSON.parse(readFileSync("services/race-server/railway.json", "utf8")) as {
  $schema: string;
  deploy: Record<string, unknown>;
};
/** Railway's schema types these as numbers (a string fails its validation). */
const seconds = (key: string) => {
  const value = config.deploy[key];
  expect(typeof value).toBe("number");
  return value as number;
};

/** Time between the drain's own exit at the cap and Railway's SIGKILL: closing sockets and Redis. */
const MARGIN_S = 30;

describe("race-server Railway deploy config (#704 C2)", () => {
  it("uses Railway's config-as-code schema", () => {
    expect(config.$schema).toBe("https://railway.com/railway.schema.json");
  });

  it("waits for the drain cap and its margin before SIGKILL", () => {
    expect(Number.isInteger(seconds("drainingSeconds"))).toBe(true);
    expect(seconds("drainingSeconds")).toBeGreaterThanOrEqual(DEFAULT_DRAIN_CAP_S + MARGIN_S);
  });

  it("does not overlap: the new deployment takes new rooms as soon as it is healthy", () => {
    expect(seconds("overlapSeconds")).toBe(0);
  });

  it("gates the switch on the race server's health check", () => {
    expect(config.deploy.healthcheckPath).toBe("/health");
  });

  // #781: the region (us-east4-eqdc4a) is set in the dashboard, not here (`multiRegionConfig`): Config as Code
  // is deprecated, covers only this service and stops being read on 2026-12-01 (docs/ops/region-move.md).
  it("sets only deploy settings, so the dashboard keeps the build, start, watch paths and region", () => {
    expect(Object.keys(config).sort()).toEqual(["$schema", "deploy"]);
    expect(Object.keys(config.deploy).sort()).toEqual([
      "drainingSeconds",
      "healthcheckPath",
      "overlapSeconds",
    ]);
  });
});
