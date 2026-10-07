import sharp, { type Sharp } from "sharp";
import { describe, expect, it } from "vitest";
import {
  LOW_ENTROPY_BITS,
  SKIN_FLAG_RATIO,
  SMOOTH_SKIN_RATIO,
  heuristicModerator,
  isSkinTone,
  lumaEntropy,
  skinRatio,
} from "./heuristic";
import { statusFor, type ModerationReason, type ModerationVerdict } from "./moderator";

// ADR 0015. Fixtures are synthetic and generated here (no binary files, no real photos), then
// encoded like storeAvatar's output: the moderator only ever sees the 256 px WebP.
type Rgb = { r: number; g: number; b: number };
const SIZE = 256;
const GREY: Rgb = { r: 128, g: 128, b: 128 };
const SKIN_LIGHT: Rgb = { r: 224, g: 172, b: 140 };
const SKIN_MID: Rgb = { r: 198, g: 134, b: 66 };
const SKIN_DARK: Rgb = { r: 141, g: 85, b: 36 };

const plain = (c: Rgb) =>
  sharp({ create: { width: SIZE, height: SIZE, channels: 3, background: c } });

/** Deterministic "photo-like" noise: every channel of every pixel drawn from a seeded LCG. */
function noise(seed = 1) {
  let s = seed;
  const data = Buffer.alloc(SIZE * SIZE * 3);
  for (let i = 0; i < data.length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    data[i] = s % 256;
  }
  return sharp(data, { raw: { width: SIZE, height: SIZE, channels: 3 } });
}

/** A square of `colour` covering `fraction` of the image, top-left, over `background`. */
async function block(background: Sharp, colour: Rgb, fraction: number) {
  const side = Math.round(SIZE * Math.sqrt(fraction));
  const square = await plain(colour).resize(side, side).png().toBuffer();
  const base = await background.png().toBuffer();
  return sharp(base).composite([{ input: square, left: 0, top: 0 }]);
}

const asStored = async (image: Sharp | Promise<Sharp>) =>
  (await image).resize(SIZE, SIZE).webp({ quality: 82 }).toBuffer();

describe("heuristic moderator (C3, ADR 0015)", () => {
  const table: [string, () => Sharp | Promise<Sharp>, ModerationVerdict, ModerationReason][] = [
    ["plain red", () => plain({ r: 255, g: 0, b: 0 }), "approve", "clear"],
    ["plain dark red", () => plain({ r: 204, g: 51, b: 51 }), "approve", "clear"],
    ["plain grey", () => plain(GREY), "approve", "clear"],
    ["plain white", () => plain({ r: 255, g: 255, b: 255 }), "approve", "clear"],
    ["plain black", () => plain({ r: 0, g: 0, b: 0 }), "approve", "clear"],
    ["plain navy", () => plain({ r: 31, g: 42, b: 68 }), "approve", "clear"],
    ["plain green", () => plain({ r: 0, g: 192, b: 0 }), "approve", "clear"],
    ["photo-like noise", () => noise(1), "approve", "clear"],
    ["photo-like noise, other seed", () => noise(7), "approve", "clear"],
    ["30% skin block over noise", () => block(noise(3), SKIN_LIGHT, 0.3), "approve", "clear"],
    ["light skin-tone block", () => plain(SKIN_LIGHT), "flag", "skin"],
    ["medium skin-tone block", () => plain(SKIN_MID), "flag", "skin"],
    ["dark skin-tone block", () => plain(SKIN_DARK), "flag", "skin"],
    ["60% skin block over noise", () => block(noise(5), SKIN_LIGHT, 0.6), "flag", "skin"],
    [
      "30% flat skin block over grey",
      () => block(plain(GREY), SKIN_MID, 0.3),
      "flag",
      "smooth-skin",
    ],
  ];

  it.each(table)("%s -> %s (%s)", async (_label, make, verdict, reason) => {
    expect(await heuristicModerator.check(await asStored(make()))).toEqual({ verdict, reason });
  });

  it("never rejects: a flag is not proof, a person decides", async () => {
    for (const [, make] of table) {
      expect((await heuristicModerator.check(await asStored(make()))).verdict).not.toBe("reject");
    }
  });

  it("pins the thresholds recorded in the ADR", () => {
    expect({ SKIN_FLAG_RATIO, SMOOTH_SKIN_RATIO, LOW_ENTROPY_BITS }).toEqual({
      SKIN_FLAG_RATIO: 0.5,
      SMOOTH_SKIN_RATIO: 0.25,
      LOW_ENTROPY_BITS: 1.5,
    });
  });

  it("isSkinTone needs both the RGB rule and the YCbCr box", () => {
    for (const c of [SKIN_LIGHT, SKIN_MID, SKIN_DARK]) expect(isSkinTone(c.r, c.g, c.b)).toBe(true);
    // Passes the RGB rule, outside the Cr box: saturated red is not skin.
    expect(isSkinTone(204, 51, 51)).toBe(false);
    for (const [r, g, b] of [
      [128, 128, 128],
      [0, 0, 255],
      [0, 192, 0],
      [255, 255, 255],
      [0, 0, 0],
    ] as const) {
      expect(isSkinTone(r, g, b)).toBe(false);
    }
  });

  it("skinRatio and lumaEntropy work on raw RGB", () => {
    const flat = Buffer.from([10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]);
    expect(lumaEntropy(flat)).toBe(0);
    expect(skinRatio(flat)).toBe(0);
    const half = Buffer.from([...Object.values(SKIN_LIGHT), 0, 0, 0]);
    expect(skinRatio(half)).toBe(0.5);
    expect(lumaEntropy(half)).toBeCloseTo(1, 5);
    expect(skinRatio(Buffer.alloc(0))).toBe(0);
    expect(lumaEntropy(Buffer.alloc(0))).toBe(0);
  });

  it("an image the decoder cannot read is flagged, never approved (fail safe)", async () => {
    expect(await heuristicModerator.check(Buffer.from("not an image"))).toEqual({
      verdict: "flag",
      reason: "unreadable",
    });
  });
});

describe("statusFor (verdict -> AvatarStatus)", () => {
  it("approve is APPROVED, flag is PENDING, reject is REJECTED", () => {
    expect(statusFor("approve")).toBe("APPROVED");
    expect(statusFor("flag")).toBe("PENDING");
    expect(statusFor("reject")).toBe("REJECTED");
  });
});
