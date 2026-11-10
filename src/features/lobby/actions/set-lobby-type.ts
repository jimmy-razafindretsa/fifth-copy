"use server";

import { revalidatePath } from "next/cache";
import { parseRoomCode, PROTOCOL_VERSION } from "@fifth-copy/protocol";
import { env } from "@/env";
import { getViewer } from "@/server/auth";
import { db } from "@/server/db";
import { createInternalApiClient } from "@/server/internal-api/client";
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
 * nothing. Then the room is told first (#815, `POST /internal/rooms/type`): the row is written only on
 * its `ok`, so Postgres and the room never disagree; a room past `waiting` or gone is `closed`, no answer
 * (timeout, 5xx, unparsable body) is `unavailable`. The room broadcasts its new settings and reviews
 * its automatic start (#814). On success `/lobby/[code]` is revalidated, so the host's page shows the
 * new type at once; the others' LOBBY rows read it on their next load (#114 C4).
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
  const room = await createInternalApiClient({
    baseUrl: env.RACE_SERVER_INTERNAL_URL,
    secret: env.RACE_TOKEN_SECRET,
  })
    .setRoomType({ v: PROTOCOL_VERSION, lobbyId: lobby.id, lobbyType: parsed.data.type })
    .catch(() => ({ ok: false as const }));
  if (!room.ok) return { ok: false, error: "unavailable" };
  if (room.data.result !== "ok") return { ok: false, error: "closed" };
  await db.lobby.update({
    where: { id: lobby.id },
    data: { type: parsed.data.type === "public" ? "PUBLIC" : "PRIVATE" },
  });
  revalidatePath(`/lobby/${lobby.code}`);
  return { ok: true };
}
