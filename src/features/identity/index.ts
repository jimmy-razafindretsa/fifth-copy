// Public identity API (ARCHITECTURE 8.2). Server-only at runtime: client
// components may only `import type { Viewer }` from here.
export { getViewer, requireViewer, UnauthenticatedError, type Viewer } from "@/server/auth";
export { ensureGuest } from "./actions/ensure-guest";
export { uploadAvatar, type UploadAvatarResult } from "./actions/upload-avatar";
export { importOauthAvatar, type ImportOauthAvatarResult } from "./avatars/import-oauth-avatar";
export { readAvatarFile } from "./queries/avatar-file";
export { avatarStore } from "./avatars/default-store";
export type { AvatarStore, AvatarSize } from "./avatars/store";
export type { AvatarErrorCode } from "./avatars/errors";
export { avatarNotice } from "./avatars/moderation/notice";
export { avatarQuery, normalizeUsername } from "./schema";
// The keyboard layouts (R179, #224): pure data the race machine, the settings picker (#66) and the heatmap read.
export { keyboardLayoutIds, layouts, type KeyboardLayoutId } from "./keyboard/layouts";
