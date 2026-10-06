import "server-only";
import { env } from "@/env";
import { FsAvatarStore } from "./fs-store";
import type { AvatarStore } from "./store";

// Built on first use, so importing the identity API never touches AVATAR_DIR.
let instance: FsAvatarStore | undefined;
const fs = () => (instance ??= new FsAvatarStore(env.AVATAR_DIR));

/** The app's avatar store (ADR 0014): files under AVATAR_DIR. */
export const avatarStore: AvatarStore = {
  put: (userId, version, files) => fs().put(userId, version, files),
  get: (userId, version, size) => fs().get(userId, version, size),
  delete: (userId, options) => fs().delete(userId, options),
};
