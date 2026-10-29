import { describe, expect, it } from "vitest";
import {
  medalEmbedSrc,
  medalVariantMessage,
  motionMessage,
  parseMedalVariantMessage,
  parseMotionMessage,
} from "./embed-messages";

describe("medal messages (#300 C4, bible 15)", () => {
  it("builds the page -> medal messages", () => {
    expect(medalVariantMessage("silver")).toEqual({ type: "fc-medal-variant", variant: "silver" });
    expect(motionMessage(true)).toEqual({ type: "fc-motion", reduce: true });
    expect(medalEmbedSrc("bronze")).toBe("/3d/medal.html?embed=1&variant=bronze");
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
