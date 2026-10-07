"use server";

import { revalidatePath } from "next/cache";
import { requireViewer } from "@/server/auth";
import { db } from "@/server/db";
import { AvatarError, type AvatarErrorCode } from "../avatars/errors";
import { MAX_AVATAR_BYTES, storeAvatar, type StoredAvatarStatus } from "../avatars/store-avatar";
import { uploadAvatarInput } from "../schema";

/** `status` PENDING: stored but hidden behind the default portrait until reviewed (ADR 0015). */
export type UploadAvatarResult =
  { ok: true; version: number; status: StoredAvatarStatus } | { ok: false; code: AvatarErrorCode };

/**
 * Sets the viewer's own avatar (ADR 0014). Guests allowed. Reads only the `file` and `crop` fields:
 * the target is always the viewer, never an id from the form. The size cap is checked before the
 * bytes are read; storeAvatar does the rest (moderation included, ADR 0015) and commits the new key
 * before old files are removed. A rejected picture is `{ ok: false, code: "Rejected" }`: nothing
 * written, the previous avatar and row untouched.
 */
export async function uploadAvatar(formData: FormData): Promise<UploadAvatarResult> {
  const viewer = await requireViewer();

  const file = formData.get("file");
  if (!(file instanceof Blob)) return { ok: false, code: "WrongType" };
  if (file.size > MAX_AVATAR_BYTES) return { ok: false, code: "TooLarge" };
  const input = uploadAvatarInput.safeParse({ file, crop: formData.get("crop") });
  if (!input.success) return { ok: false, code: "BadCrop" };

  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const { version, status } = await storeAvatar(viewer.id, bytes, input.data.crop, {
      commit: async ({ key, status }) => {
        await db.user.update({
          where: { id: viewer.id },
          data: { avatarKey: key, avatarStatus: status },
        });
      },
    });
    revalidatePath("/", "layout");
    return { ok: true, version, status };
  } catch (error) {
    if (error instanceof AvatarError) return { ok: false, code: error.code };
    throw error;
  }
}
