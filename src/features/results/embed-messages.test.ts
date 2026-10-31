import { describe, expect, it } from "vitest";
import {
  medalVariantMessage,
  motionMessage,
  parseClerkReady,
  parseMedalVariantMessage,
  parseMotionMessage,
  podiumClerkSrc,
  setCfgMessage,
} from "./embed-messages";

const OUTFIT = {
  hair: "quiff",
  glasses: "monocle",
  hat: "beret",
  clothes: "jacket",
  face: "beard",
  hairCol: "#A4552A",
};

describe("medal messages (#300 C4, bible 15)", () => {
  it("builds the page -> embed messages", () => {
    expect(medalVariantMessage("silver")).toEqual({ type: "fc-medal-variant", variant: "silver" });
    expect(motionMessage(true)).toEqual({ type: "fc-motion", reduce: true });
    expect(setCfgMessage(OUTFIT)).toEqual({ type: "fc-setcfg", cfg: OUTFIT });
  });

  it("accepts only known variants and boolean motion, dropping extra fields", () => {
    expect(parseMedalVariantMessage({ type: "fc-medal-variant", variant: "gold", x: 1 })).toEqual({
      type: "fc-medal-variant",
      variant: "gold",
    });
    for (const bad of [
      null,
      "fc-medal-variant",
      [],
      { type: "fc-medal-variant", variant: "tin" },
    ]) {
      expect(parseMedalVariantMessage(bad)).toBeNull();
    }
    expect(parseMotionMessage({ type: "fc-motion", reduce: false })).toEqual(motionMessage(false));
    expect(parseMotionMessage({ type: "fc-motion", reduce: "yes" })).toBeNull();
    expect(parseMotionMessage({ type: "fc-look", reduce: true })).toBeNull();
  });
});

describe("plinth clerk messages (#688 C2, C3)", () => {
  it("the frame URL carries the embed flag, the variant and the outfit as URL-encoded JSON", () => {
    const src = podiumClerkSrc("bronze", OUTFIT);
    expect(src).toBe(
      `/3d/podium-clerk.html?embed=1&variant=bronze&cfg=${encodeURIComponent(JSON.stringify(OUTFIT))}`,
    );
    expect(JSON.parse(new URL(src, "http://x").searchParams.get("cfg")!)).toEqual(OUTFIT);
  });

  it("parseClerkReady keeps the six outfit strings of an fc-clerk and nothing else", () => {
    expect(parseClerkReady({ type: "fc-clerk", cfg: { ...OUTFIT, extra: "x" }, more: 1 })).toEqual({
      type: "fc-clerk",
      cfg: OUTFIT,
    });
    for (const bad of [
      null,
      "fc-clerk",
      [],
      { type: "fc-clerk" },
      { type: "fc-clerk", cfg: [] },
      { type: "fc-clerk", cfg: { ...OUTFIT, hat: 3 } },
      { type: "fc-clerk", cfg: { ...OUTFIT, hairCol: undefined } },
      { type: "fc-setcfg", cfg: OUTFIT },
    ]) {
      expect(parseClerkReady(bad)).toBeNull();
    }
  });
});
