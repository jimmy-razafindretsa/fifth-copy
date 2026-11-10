"use server";

import { parseRoomCode } from "@fifth-copy/protocol";
import { env } from "@/env";
import { getViewer } from "@/server/auth";
import { limit } from "@/server/limiter";
import { newInviteToken } from "../invite-token";
import { inviteStore } from "../invites/store";
import { findLobbyByCode } from "../queries/get-lobby-by-code";
import { codeInputSchema } from "../schema";
import type { CreateInviteResult } from "../types";

/**
 * Issues a single-use invite link to a waiting lobby (#808, ADR 0008). The input is parsed first;
 * the host is the row's `hostUserId` compared with the viewer, never an id from the input, and no
 * guest is created. The host's `invite` budget (`user:<id>`, ADR 0020) is spent before the one
 * write: `SET web:invite:<token> <lobbyId> NX EX 86400`. Redis down or slow: `unavailable`.
 */
export async function createInvite(input: { code: string }): Promise<CreateInviteResult> {
  const parsed = codeInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  try {
    const code = parseRoomCode(parsed.data.code);
    const lobby = code ? await findLobbyByCode(code) : null;
    if (!lobby) return { ok: false, error: "not-found" };
    const viewer = await getViewer();
    if (!viewer || viewer.id !== lobby.hostUserId) return { ok: false, error: "not-host" };
    if (lobby.status !== "WAITING") return { ok: false, error: "closed" };
    if (!(await limit("invite", `user:${viewer.id}`)).ok) {
      return { ok: false, error: "rate-limited" };
    }
    // A collision of 256-bit tokens does not happen; NX makes one harmless, and one redraw ends it.
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = newInviteToken();
      const stored = await inviteStore().put(token, lobby.id);
      if (stored === "unavailable") break;
      if (stored === "ok") {
        return { ok: true, url: `${env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "")}/invite/${token}` };
      }
    }
    return { ok: false, error: "unavailable" };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}
