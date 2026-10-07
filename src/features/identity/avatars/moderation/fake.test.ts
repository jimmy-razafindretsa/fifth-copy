import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { fakeModerator } from "./fake";

// C6: the fake moderator (AVATAR_MODERATOR=fake, never in production) reads the verdict from the
// image's dominant colour, so #60's e2e can drive both messages with plain fixtures.
const image = (background: { r: number; g: number; b: number }, format: "webp" | "png" = "webp") =>
  sharp({ create: { width: 256, height: 256, channels: 3, background } })
    [format]()
    .toBuffer();

describe("fake moderator (C6)", () => {
  it.each([
    ["green", { r: 0, g: 200, b: 0 }, "approve"],
    ["blue", { r: 0, g: 0, b: 220 }, "flag"],
    ["red", { r: 220, g: 0, b: 0 }, "reject"],
    ["mostly green", { r: 60, g: 180, b: 70 }, "approve"],
    ["mostly blue", { r: 40, g: 60, b: 200 }, "flag"],
    ["mostly red", { r: 200, g: 40, b: 50 }, "reject"],
  ] as const)("%s -> %s", async (_label, colour, verdict) => {
    expect(await fakeModerator.check(await image(colour))).toEqual({ verdict, reason: "fake" });
  });

  it("an image with no dominant channel (grey, white) is approved", async () => {
    for (const c of [
      { r: 128, g: 128, b: 128 },
      { r: 255, g: 255, b: 255 },
    ]) {
      expect((await fakeModerator.check(await image(c))).verdict).toBe("approve");
    }
  });

  it("an unreadable image is flagged (fail safe, like the heuristic)", async () => {
    expect(await fakeModerator.check(Buffer.from("nope"))).toEqual({
      verdict: "flag",
      reason: "unreadable",
    });
  });
});
