// Avatar moderation port (ADR 0015). storeAvatar calls it on the re-encoded 256 px WebP, never on
// the original upload, and before any file is written. Implementations: heuristic.ts (default),
// fake.ts (tests and e2e, refused in production by src/env.ts).

export type ModerationVerdict = "approve" | "flag" | "reject";
/** Why, for logs and tests only: never persisted (Law 25, minimal data). */
export type ModerationReason = "clear" | "skin" | "smooth-skin" | "unreadable" | "fake";
export type ModerationResult = { verdict: ModerationVerdict; reason: ModerationReason };

export interface AvatarModerator {
  check(image: Buffer): Promise<ModerationResult>;
}

/**
 * The AvatarStatus a stored avatar gets from its verdict. `reject` is never stored (storeAvatar
 * throws Rejected first), and anything else is a broken moderator: refuse loudly, store nothing.
 */
export function statusFor(verdict: "approve" | "flag"): "APPROVED" | "PENDING" {
  if (verdict === "approve") return "APPROVED";
  if (verdict === "flag") return "PENDING";
  throw new Error("Avatar moderator returned an unusable verdict");
}
