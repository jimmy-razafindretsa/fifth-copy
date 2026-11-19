"use server";

import { parseRoomCode } from "@fifth-copy/protocol";
import { ensureGuest } from "@/features/identity";
import { limitCode, requestSubject } from "@/server/limiter";
import { codeProofStore } from "@/server/room-code-proof";
import { findLobbyByCode } from "../queries/get-lobby-by-code";
import { proveRoomCodeInputSchema } from "../schema";
import type { ProveRoomCodeResult } from "../types";

/**
 * The race page's code entry (#999 C13): a viewer the page served no code (no proof on file, not the
 * host) types the room's code; a match records the proof `web:code-proof:<viewer>:<lobby>` so the page,
 * refreshed, serves the code and the seat or the projector mints with it. Checked as `joinByCode`:
 * the (client, code) budget first, then the code parsed, then the lobby by code, which must be the
 * page's lobby (another room's code is `not-found`, never a hint). A CLOSED room takes no new proof
 * (`closed`): only a viewer who proved the code while it was open may come back to it. The guest is
 * created only after a match. A proof Redis could not write is `unavailable` (fail closed).
 */
export async function proveRoomCode(input: {
  lobbyId: string;
  code: string;
}): Promise<ProveRoomCodeResult> {
  const parsed = proveRoomCodeInputSchema.safeParse(input);
  const code = parsed.success ? parseRoomCode(parsed.data.code) : null;
  if (!(await limitCode("join-by-code", await requestSubject(), code)).ok) {
    return { ok: false, error: "rate-limited" };
  }
  if (!parsed.success || !code) return { ok: false, error: "invalid-format" };
  const lobby = await findLobbyByCode(code);
  if (!lobby || lobby.id !== parsed.data.lobbyId) return { ok: false, error: "not-found" };
  if (lobby.status !== "WAITING") return { ok: false, error: "closed" };
  const viewer = await ensureGuest();
  if (!(await codeProofStore().record(viewer.id, lobby.id))) {
    return { ok: false, error: "unavailable" };
  }
  return { ok: true };
}
