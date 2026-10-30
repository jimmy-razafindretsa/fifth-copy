"use server";

import { parseRoomCode } from "@fifth-copy/protocol";
import { limitCode, requestSubject } from "@/server/limiter";
import { codeInputSchema } from "../schema";
import { findLobbyByCode } from "../queries/get-lobby-by-code";
import type { JoinByCodeResult } from "../types";

// Resolves a typed room code to an open lobby. Read-only: creates no guest. Every attempt is
// checked before the lookup (#207, #699): per (guest or IP, code), so a class behind one address
// can all join its lobby, and against the subject's distinct-code budget, so codes cannot be
// guessed fast.
export async function joinByCode(input: { code: string }): Promise<JoinByCodeResult> {
  const parsed = codeInputSchema.safeParse(input);
  const code = parsed.success ? parseRoomCode(parsed.data.code) : null;
  if (!(await limitCode("join-by-code", await requestSubject(), code)).ok) {
    return { ok: false, error: "rate-limited" };
  }
  if (!code) return { ok: false, error: "invalid-format" };

  const lobby = await findLobbyByCode(code);
  if (!lobby) return { ok: false, error: "not-found" };
  if (lobby.status !== "WAITING") return { ok: false, error: "closed" };
  return { ok: true, code };
}
