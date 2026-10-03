import { describe, expect, it } from "vitest";
import { healthBody } from "./health";

describe("race-server health", () => {
  it("reports ok while not draining and carries engine and protocol versions", () => {
    const body = healthBody({ rooms: 2, draining: false });
    expect(body.ok).toBe(true);
    expect(body.rooms).toBe(2);
    expect(body.engine).toMatch(/^\d+\.\d+\.\d+$/);
    expect(body.protocol).toBeGreaterThan(0);
  });
  it("reports not ok while draining so the load balancer stops sending new rooms", () => {
    expect(healthBody({ rooms: 0, draining: true }).ok).toBe(false);
  });
});
