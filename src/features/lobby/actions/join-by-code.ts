"use server";

import { parseRoomCode } from "@fifth-copy/protocol";
import { limit, requestSubject } from "@/server/limiter";
import { codeInputSchema } from "../schema";
import { findLobbyByCode } from "../queries/get-lobby-by-code";
import type { JoinByCodeResult } from "../types";

// Resolves a typed room code to an open lobby. Read-only: creates no guest. Every attempt counts
// against the `join-by-code` limit of the guest or IP (#207), so codes cannot be guessed fast.
export async function joinByCode(input: { code: string }): Promise<JoinByCodeResult> {
  if (!(await limit("join-by-code", await requestSubject())).ok) {
    return { ok: false, error: "rate-limited" };
  }
  const parsed = codeInputSchema.safeParse(input);
  const code = parsed.success ? parseRoomCode(parsed.data.code) : null;
  if (!code) return { ok: false, error: "invalid-format" };

  const lobby = await findLobbyByCode(code);
  if (!lobby) return { ok: false, error: "not-found" };
  if (lobby.status !== "WAITING") return { ok: false, error: "closed" };
  return { ok: true, code };
}
