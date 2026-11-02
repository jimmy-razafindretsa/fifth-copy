"use server";

import { revalidatePath } from "next/cache";
import { parseRoomCode } from "@fifth-copy/protocol";
import { getViewer } from "@/server/auth";
import { db } from "@/server/db";
import { limit } from "@/server/limiter";
import { findLobbyByCode } from "../queries/get-lobby-by-code";
import { setLobbyTypeInputSchema } from "../schema";
import type { SetLobbyTypeResult } from "../types";

/**
 * Files the lobby's visibility (#114, spec 8 "Lobby: public / private"): the one writer of `Lobby.type`
 * (ADR 0008: Postgres owns it, `host:settings` never carries it), read by the kicker (#105), the listing
 * (#127) and matchmaking (#128). The input is parsed first; the host is the row's `hostUserId` compared
 * with the viewer, never an id from the input, and no guest is created for it. The lobby must still be
 * WAITING. Changes count against the host's `set-lobby-type` limit (ADR 0020); a refused call writes
 * nothing. On success `/lobby/[code]` is revalidated, so the host's page shows the new type at once;
 * the others read it on their next load (no broadcast, #114 C4).
 */
export async function setLobbyType(input: {
  code: string;
  type: "public" | "private";
}): Promise<SetLobbyTypeResult> {
  const parsed = setLobbyTypeInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const code = parseRoomCode(parsed.data.code);
  const lobby = code ? await findLobbyByCode(code) : null;
  if (!lobby) return { ok: false, error: "not-found" };
  const viewer = await getViewer();
  if (!viewer || viewer.id !== lobby.hostUserId) return { ok: false, error: "not-host" };
  if (lobby.status !== "WAITING") return { ok: false, error: "closed" };
  if (!(await limit("set-lobby-type", `user:${viewer.id}`)).ok) {
    return { ok: false, error: "rate-limited" };
  }
  await db.lobby.update({
    where: { id: lobby.id },
    data: { type: parsed.data.type === "public" ? "PUBLIC" : "PRIVATE" },
  });
  revalidatePath(`/lobby/${lobby.code}`);
  return { ok: true };
}
