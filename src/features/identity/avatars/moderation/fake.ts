import type { AvatarModerator, ModerationVerdict } from "./moderator";
import { rawRgb } from "./raw";

// Test moderator (ADR 0015, AVATAR_MODERATOR=fake; src/env.ts refuses it in production). The
// verdict comes from the dominant colour, so e2e fixtures are plain squares: green approve,
// blue flag, red reject. No dominant channel (grey, white, black) approves.

/** A channel dominates when its mean beats both others by this much (0-255 scale). */
const DOMINANCE = 40;

export const fakeModerator: AvatarModerator = {
  async check(image) {
    const rgb = await rawRgb(image);
    if (!rgb) return { verdict: "flag", reason: "unreadable" };
    const sums = [0, 0, 0];
    for (let i = 0; i < rgb.length; i++) sums[i % 3]! += rgb[i]!;
    const [r, g, b] = sums.map((s) => s / (rgb.length / 3)) as [number, number, number];
    const verdict: ModerationVerdict =
      r - Math.max(g, b) >= DOMINANCE
        ? "reject"
        : b - Math.max(r, g) >= DOMINANCE
          ? "flag"
          : "approve";
    return { verdict, reason: "fake" };
  },
};
