import type { AvatarModerator, ModerationResult } from "./moderator";
import { rawRgb } from "./raw";

// ADR 0015: a cheap local check, no network, no model. It flags for a person to review and never
// rejects (a flag is not proof, docs/privacy/moderation.md). Thresholds are pinned by
// moderator.test.ts and recorded in the ADR; changing one is a PR that updates both.

/** At least this share of skin-toned pixels: flag. */
export const SKIN_FLAG_RATIO = 0.5;
/** At least this share of skin-toned pixels and a flat picture (entropy below LOW_ENTROPY_BITS): flag. */
export const SMOOTH_SKIN_RATIO = 0.25;
/** Shannon entropy of the 32-bin luma histogram, in bits (0 to 5). */
export const LOW_ENTROPY_BITS = 1.5;
const LUMA_BINS = 32;

/** RGB rule and YCbCr box together (each alone has many false positives). */
export function isSkinTone(r: number, g: number, b: number): boolean {
  const rgb =
    r > 95 &&
    g > 40 &&
    b > 20 &&
    Math.max(r, g, b) - Math.min(r, g, b) > 15 &&
    Math.abs(r - g) > 15 &&
    r > g &&
    r > b;
  if (!rgb) return false;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173;
}

/** Share of skin-toned pixels in a raw RGB buffer (0 for an empty one). */
export function skinRatio(rgb: Buffer): number {
  const pixels = Math.floor(rgb.length / 3);
  if (pixels === 0) return 0;
  let skin = 0;
  for (let i = 0; i < pixels * 3; i += 3) {
    if (isSkinTone(rgb[i]!, rgb[i + 1]!, rgb[i + 2]!)) skin++;
  }
  return skin / pixels;
}

/** Shannon entropy (bits) of the luma histogram of a raw RGB buffer (0 for an empty one). */
export function lumaEntropy(rgb: Buffer): number {
  const pixels = Math.floor(rgb.length / 3);
  if (pixels === 0) return 0;
  const bins = new Array<number>(LUMA_BINS).fill(0);
  for (let i = 0; i < pixels * 3; i += 3) {
    const luma = 0.299 * rgb[i]! + 0.587 * rgb[i + 1]! + 0.114 * rgb[i + 2]!;
    bins[Math.min(LUMA_BINS - 1, Math.floor((luma * LUMA_BINS) / 256))]!++;
  }
  let entropy = 0;
  for (const count of bins) {
    if (count === 0) continue;
    const p = count / pixels;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/** The verdict for one raw RGB buffer. */
export function judge(rgb: Buffer): ModerationResult {
  const skin = skinRatio(rgb);
  if (skin >= SKIN_FLAG_RATIO) return { verdict: "flag", reason: "skin" };
  if (skin >= SMOOTH_SKIN_RATIO && lumaEntropy(rgb) < LOW_ENTROPY_BITS) {
    return { verdict: "flag", reason: "smooth-skin" };
  }
  return { verdict: "approve", reason: "clear" };
}

export const heuristicModerator: AvatarModerator = {
  async check(image) {
    const rgb = await rawRgb(image);
    // Our own encoder produced it, so this should not happen; if it does, a person looks.
    return rgb ? judge(rgb) : { verdict: "flag", reason: "unreadable" };
  },
};
