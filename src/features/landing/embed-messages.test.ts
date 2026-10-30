import { describe, expect, it } from "vitest";
import { parseClerkMessage, parseViewMessage } from "./embed-messages";

// #626: the embed messages are parsed by hand-written guards (no zod in the landing first load);
// they accept and reject exactly what the former zod schemas did.
const cfg = { hair: "bob", glasses: "none", hat: "cap", clothes: "suit", face: "calm" };

describe("parseClerkMessage", () => {
  it("accepts an fc-clerk message and returns only the outfit fields", () => {
    expect(parseClerkMessage({ type: "fc-clerk", cfg, extra: 1 })).toEqual({
      type: "fc-clerk",
      cfg,
    });
    expect(parseClerkMessage({ type: "fc-clerk", cfg: { ...cfg, hairCol: "#000", x: 1 } })).toEqual(
      {
        type: "fc-clerk",
        cfg: { ...cfg, hairCol: "#000" },
      },
    );
  });

  it.each([
    ["null", null],
    ["a string", "fc-clerk"],
    ["an array", [cfg]],
    ["another type", { type: "fc-view", cfg }],
    ["no cfg", { type: "fc-clerk" }],
    ["a missing slot", { type: "fc-clerk", cfg: { ...cfg, hat: undefined } }],
    ["a non-string slot", { type: "fc-clerk", cfg: { ...cfg, face: 3 } }],
    ["a non-string hair colour", { type: "fc-clerk", cfg: { ...cfg, hairCol: 0 } }],
  ])("rejects %s", (_name, data) => {
    expect(parseClerkMessage(data)).toBeNull();
  });
});

describe("parseViewMessage", () => {
  it.each(["over", "pov"] as const)("accepts view %s", (view) => {
    expect(parseViewMessage({ type: "fc-view", view })).toEqual({ type: "fc-view", view });
  });

  it.each([
    ["auto (page-side only)", { type: "fc-view", view: "auto" }],
    ["another type", { type: "fc-clerk", view: "pov" }],
    ["undefined", undefined],
  ])("rejects %s", (_name, data) => {
    expect(parseViewMessage(data)).toBeNull();
  });
});
