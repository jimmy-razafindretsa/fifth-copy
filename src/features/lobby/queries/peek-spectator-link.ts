import "server-only";
import { limit, requestSubject } from "@/server/limiter";
import { spectatorLinkStore } from "../spectator-links/store";
import { spectatorLinkTokenSchema } from "../schema";
import { findLobbyForWatch } from "./get-lobby-by-id";

export type PeekSpectatorLinkResult =
  { ok: true; lobbyId: string } | { ok: false; error: "refused" | "rate-limited" | "unavailable" };

/**
 * What `/watch/[token]` opens (#999 C12): the room a spectator link points at, by lobby id only (never
 * its code, C13). Reading consumes nothing (link previews and the projector's reloads read it). The
 * client's `watch` budget is spent first; a malformed, unknown or expired token, or a room that is gone,
 * is `refused`; Redis down or slow is `unavailable` (fail closed). No guest is created here: the
 * spectator mint creates one on demand.
 */
export async function peekSpectatorLink(token: string): Promise<PeekSpectatorLinkResult> {
  if (!(await limit("watch", await requestSubject())).ok) {
    return { ok: false, error: "rate-limited" };
  }
  const parsed = spectatorLinkTokenSchema.safeParse(token);
  if (!parsed.success) return { ok: false, error: "refused" };
  const lobbyId = await spectatorLinkStore().get(parsed.data);
  if (lobbyId === "unavailable") return { ok: false, error: "unavailable" };
  const lobby = lobbyId ? await findLobbyForWatch(lobbyId) : null;
  return lobby ? { ok: true, lobbyId: lobby.id } : { ok: false, error: "refused" };
}
