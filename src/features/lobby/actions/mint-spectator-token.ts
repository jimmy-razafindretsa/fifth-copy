"use server";

import { PROTOCOL_VERSION } from "@fifth-copy/protocol";
import { env } from "@/env";
import { ensureGuest, getAvatarUser } from "@/features/identity";
import { limit, requestSubject } from "@/server/limiter";
import { signRaceToken } from "@/server/race-token";
import { spectatorLinkStore } from "../spectator-links/store";
import { findLobbyForWatch } from "../queries/get-lobby-by-id";
import { spectatorLinkTokenSchema } from "../schema";
import type { SpectatorTokenResult } from "../types";

/**
 * Mints a read-only `spectator` race token through a spectator link (#999 C12, C13; ADR 0009): the
 * `/watch/[token]` page binds its token as the first argument (the token is already the page's URL;
 * any later argument, the projector's `{ code: null, spectator: true }`, is ignored). Order, so a
 * refused call reads nothing and creates no guest: the `watch` budget per client first, the token
 * parsed, the link looked up (reusable, never consumed; Redis down or slow is `unavailable`: fail
 * closed), then the lobby by id (its code is never read). A WAITING room or a CLOSED one whose race
 * may still run (a projector reloaded mid-race) both mint; the race server answers a gone room. Only
 * then is the guest created on demand. No room code proof is recorded: the link is not the code, and
 * nothing this returns carries the code.
 */
export async function mintSpectatorToken(token: string): Promise<SpectatorTokenResult> {
  try {
    if (!(await limit("watch", await requestSubject())).ok) {
      return { ok: false, error: "rate-limited" };
    }
    const parsed = spectatorLinkTokenSchema.safeParse(token);
    if (!parsed.success) return { ok: false, error: "not-found" };
    const lobbyId = await spectatorLinkStore().get(parsed.data);
    if (lobbyId === "unavailable") return { ok: false, error: "unavailable" };
    const lobby = lobbyId ? await findLobbyForWatch(lobbyId) : null;
    if (!lobby) return { ok: false, error: "not-found" };

    const viewer = await ensureGuest();
    const { avatarVersion } = await getAvatarUser(viewer);
    const raceToken = await signRaceToken(
      {
        v: PROTOCOL_VERSION,
        sub: viewer.id,
        name: viewer.name,
        lobby: lobby.id,
        role: "spectator",
        avatar: avatarVersion,
      },
      { secret: env.RACE_TOKEN_SECRET },
    );
    return { ok: true, token: raceToken, url: env.NEXT_PUBLIC_RACE_SERVER_URL };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}
