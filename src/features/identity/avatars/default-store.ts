import "server-only";
import { env } from "@/env";
import { FsAvatarStore } from "./fs-store";
import type { AvatarStore } from "./store";

/** The app's avatar store (ADR 0014): files under AVATAR_DIR. */
export const avatarStore: AvatarStore = new FsAvatarStore(env.AVATAR_DIR);
