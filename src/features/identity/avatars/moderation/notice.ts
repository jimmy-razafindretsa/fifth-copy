import type { Messages } from "@/i18n/en";
import type { AvatarErrorCode } from "../errors";

type UploadOutcome =
  { ok: true; status: "APPROVED" | "PENDING" } | { ok: false; code: AvatarErrorCode };

/**
 * The moderation lines the avatar dialog (#60) shows after an upload (ADR 0015): the review
 * message for a PENDING picture, the rejection message and the appeal path for a rejected one,
 * nothing otherwise (other error codes have their own messages).
 */
export function avatarNotice(result: UploadOutcome, t: Messages): string[] {
  const m = t.settings.avatar.moderation;
  if (result.ok) return result.status === "PENDING" ? [m.pending] : [];
  return result.code === "Rejected" ? [m.rejected, m.appeal] : [];
}
