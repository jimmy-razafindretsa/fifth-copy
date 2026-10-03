import { describe, expect, it } from "vitest";
import { ENGINE_VERSION } from "./index";

// Wiring test: proves the workspace package resolves in Vitest and the version is well-formed.
describe("@fifth-copy/engine", () => {
  it("exposes a semver ENGINE_VERSION", () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
