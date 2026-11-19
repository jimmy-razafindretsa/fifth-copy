"use server";

import { parseRoomCode } from "@fifth-copy/protocol";
import { env } from "@/env";
import { getViewer } from "@/server/auth";
import { limit } from "@/server/limiter";
import { newInviteToken } from "../invite-token";
import { spectatorLinkStore } from "../spectator-links/store";
import { findLobbyByCode } from "../queries/get-lobby-by-code";
import { codeInputSchema } from "../schema";
import type { CreateSpectatorLinkResult } from "../types";

/**
 * Issues a reusable spectator link to a waiting lobby (#999 C12, ADR 0008, 0009): a projector or a
 * phone opens `/watch/<token>` and watches with only a guest identity, never told the room code (C13).
 * Shaped as `createInvite`: the input is parsed first; the host is the row's `hostUserId` compared with
 * the viewer, never an id from the input; no guest is created; the viewer's `spectator-link` budget
 * (`user:<id>`, ADR 0020) is spent before the lookup, so before the one write:
 * `SET web:watch:<token> <lobbyId> NX EX 86400`. Redis down or slow: `unavailable`.
 */
export async function createSpectatorLink(input: {
  code: string;
}): Promise<CreateSpectatorLinkResult> {
  const parsed = codeInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  try {
    const viewer = await getViewer();
    if (!viewer) return { ok: false, error: "not-host" };
    if (!(await limit("spectator-link", `user:${viewer.id}`)).ok) {
      return { ok: false, error: "rate-limited" };
    }
    const code = parseRoomCode(parsed.data.code);
    const lobby = code ? await findLobbyByCode(code) : null;
    if (!lobby) return { ok: false, error: "not-found" };
    if (viewer.id !== lobby.hostUserId) return { ok: false, error: "not-host" };
    if (lobby.status !== "WAITING") return { ok: false, error: "closed" };
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = newInviteToken();
      const stored = await spectatorLinkStore().put(token, lobby.id);
      if (stored === "unavailable") break;
      if (stored === "ok") {
        return { ok: true, url: `${env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "")}/watch/${token}` };
      }
    }
    return { ok: false, error: "unavailable" };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}
