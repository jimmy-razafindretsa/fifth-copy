"use server";

import { parseRoomCode } from "@fifth-copy/protocol";
import { limit, requestSubject } from "@/server/limiter";
import { inviteTokenSchema } from "../invite-token";
import { inviteStore } from "../invites/store";
import { findLobbyById } from "../queries/get-lobby-by-id";
import { redeemInviteInputSchema } from "../schema";
import type { PeekInviteResult, RedeemInviteResult } from "../types";

// Invite redeem and peek (#808, ADR 0008). A malformed token is `invalid` before any Redis call;
// then the `invite-redeem` budget (per `requestSubject()`: the guest, else the IP, ADR 0020); then
// one store call. Neither creates a guest nor reads the viewer: the lobby page's token mint
// creates the guest on arrival (ADR 0009). Redis down or slow: `unavailable` (fail closed).

/** Consumes the token in one GETDEL: of two concurrent redeems, exactly one gets the lobby. */
export async function redeemInvite(input: { token: string }): Promise<RedeemInviteResult> {
  const parsed = redeemInviteInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  try {
    if (!(await limit("invite-redeem", await requestSubject())).ok) {
      return { ok: false, error: "rate-limited" };
    }
    const lobbyId = await inviteStore().take(parsed.data.token);
    if (lobbyId === "unavailable") return { ok: false, error: "unavailable" };
    if (lobbyId === null) return { ok: false, error: "not-found" };
    const lobby = await findLobbyById(lobbyId);
    const code = lobby?.status === "WAITING" ? parseRoomCode(lobby.code) : null;
    if (!code) return { ok: false, error: "closed" };
    return { ok: true, code };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

/** Whether the token is on file (EXISTS); consumes nothing. Same budget as a redeem. */
export async function peekInvite(token: string): Promise<PeekInviteResult> {
  const parsed = inviteTokenSchema.safeParse(token);
  if (!parsed.success) return { ok: false, error: "invalid" };
  try {
    if (!(await limit("invite-redeem", await requestSubject())).ok) {
      return { ok: false, error: "rate-limited" };
    }
    const onFile = await inviteStore().has(parsed.data);
    if (onFile === "unavailable") return { ok: false, error: "unavailable" };
    return onFile ? { ok: true } : { ok: false, error: "not-found" };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}
