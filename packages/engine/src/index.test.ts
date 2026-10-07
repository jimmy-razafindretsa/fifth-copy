import { describe, expect, it } from "vitest";
import * as engine from "./index";

const { ENGINE_VERSION } = engine;

// Wiring test: proves the workspace package resolves in Vitest and the version is well-formed.
describe("@fifth-copy/engine", () => {
  it("exposes a semver ENGINE_VERSION", () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("is at 0.2.0 (text and reducers landed)", () => {
    expect(ENGINE_VERSION).toBe("0.2.0");
  });

  it.each([
    "normalizeTypeable",
    "isTypeable",
    "TYPEABLE",
    "wordCount",
    "charsOf",
    "initialState",
    "applyKeystroke",
    "continueMode",
    "blockMode",
    "backspace",
  ])("re-exports %s", (name) => {
    expect(engine).toHaveProperty(name);
  });

  it("drives a keystroke end to end through the public entry point", () => {
    const text = engine.normalizeTypeable("\u00ABOK\u00BB");
    const s = ['"', "O", "K", '"'].reduce(
      (st, key, i) =>
        engine.applyKeystroke(st, { t: i, key }, text, { errorMode: "block", backspace: true }),
      engine.initialState(),
    );
    expect(s).toMatchObject({ status: "finished", correct: 4, errors: 0 });
  });
});
