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

  it("sets only deploy settings, so the dashboard keeps the build, start and watch paths", () => {
    expect(Object.keys(config).sort()).toEqual(["$schema", "deploy"]);
    expect(Object.keys(config.deploy).sort()).toEqual([
      "drainingSeconds",
      "healthcheckPath",
      "overlapSeconds",
    ]);
  });
});

// #733 C5: the worker service (ADR 0011, 0019 amendment). It listens on nothing, so no health check
// and no domain; one replica (the advisory locks would also make a second one safe); a draining time
// so SIGTERM lets the running job finish (src/worker/main.ts).
describe("worker Railway config (#733 C5)", () => {
  const worker = JSON.parse(readFileSync("src/worker/railway.json", "utf8")) as {
    $schema: string;
    build: Record<string, unknown>;
    deploy: Record<string, unknown>;
  };
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts: Record<string, string>;
  };

  it("builds and starts the worker scripts of the web package", () => {
    expect(worker.$schema).toBe("https://railway.com/railway.schema.json");
    expect(worker.build.buildCommand).toBe("npm run build:worker");
    expect(worker.deploy.startCommand).toBe("npm run start:worker");
    expect(pkg.scripts["start:worker"]).toBe("node dist/worker/main.mjs");
  });

  it("exposes nothing: no health check path, one replica, a draining time for the running job", () => {
    expect(worker.deploy.healthcheckPath).toBeUndefined();
    expect(worker.deploy.numReplicas).toBe(1);
    expect(typeof worker.deploy.drainingSeconds).toBe("number");
    expect(worker.deploy.drainingSeconds as number).toBeGreaterThanOrEqual(60);
  });

  it("rebuilds when worker, job or server code changes", () => {
    expect(worker.build.watchPatterns).toEqual(
      expect.arrayContaining(["src/worker/**", "src/features/**", "src/server/**", "prisma/**"]),
    );
  });
});
