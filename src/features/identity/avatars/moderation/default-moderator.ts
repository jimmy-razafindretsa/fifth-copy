import "server-only";
import { env } from "@/env";
import { fakeModerator } from "./fake";
import { heuristicModerator } from "./heuristic";
import type { AvatarModerator } from "./moderator";

/** The app's moderator (ADR 0015), chosen by AVATAR_MODERATOR; src/env.ts refuses `fake` in production. */
export function avatarModerator(): AvatarModerator {
  return env.AVATAR_MODERATOR === "fake" ? fakeModerator : heuristicModerator;
}
