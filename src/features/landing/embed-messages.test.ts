import { describe, expect, it } from "vitest";
import { OUTFIT_CATEGORIES as IDENTITY_CATEGORIES } from "@/features/identity";
import {
  OUTFIT_CATEGORIES,
  parseClerkMessage,
  parseViewMessage,
  sameOutfit,
} from "./embed-messages";

// #626: the embed messages are parsed by hand-written guards (no zod in the landing first load);
// they accept and reject exactly what the former zod schemas did.
// Shape only: ids are the server's business (outfitSchema); hairCol is required since #687.
const cfg = {
  hair: "bob",
  glasses: "none",
  hat: "cap",
  clothes: "suit",
  face: "calm",
  hairCol: "#000",
};

describe("OUTFIT_CATEGORIES (#687 C7)", () => {
  it("equals identity's list (no third list can drift)", () => {
    expect(OUTFIT_CATEGORIES).toEqual(IDENTITY_CATEGORIES);
  });
});

describe("sameOutfit (#687 C7)", () => {
  it("compares the six slots", () => {
    expect(sameOutfit(cfg, { ...cfg })).toBe(true);
    expect(sameOutfit(cfg, null)).toBe(false);
    expect(sameOutfit(cfg, { ...cfg, hairCol: "#111" })).toBe(false);
    expect(sameOutfit(cfg, { ...cfg, face: "beard" })).toBe(false);
  });
});

describe("parseClerkMessage", () => {
  it("accepts an fc-clerk message and returns only the outfit fields", () => {
    expect(parseClerkMessage({ type: "fc-clerk", cfg, extra: 1 })).toEqual({
      type: "fc-clerk",
      cfg,
    });
    expect(parseClerkMessage({ type: "fc-clerk", cfg: { ...cfg, x: 1 } })).toEqual({
      type: "fc-clerk",
      cfg,
    });
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
    ["no hair colour", { type: "fc-clerk", cfg: { ...cfg, hairCol: undefined } }],
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
