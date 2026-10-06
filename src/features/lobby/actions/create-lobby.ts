"use server";

import { randomInt } from "node:crypto";
import type { RoomCode } from "@fifth-copy/protocol";
import { ensureGuest } from "@/features/identity";
import { Prisma, type LobbyType } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { withUniqueRoomCode } from "../code";
import { openRoom } from "../internal/open-room";
import type { CreateLobbyResult } from "../types";

// The code is the MVP's only secret, so draws come from a CSPRNG, not V8's predictable Math.random.
const secureRng = () => randomInt(2 ** 32) / 2 ** 32;

export type CreateLobbyOptions = {
  /** PRIVATE (default): joinable by code only. PUBLIC: a quick-race room, listed for matchmaking (card 128). */
  type?: LobbyType;
};

// Makes the caller (a guest created on the spot if needed) host of a new lobby with a fresh room
// code, then opens its room on the race server. No room, no lobby: the row is deleted.
export async function createLobby(options: CreateLobbyOptions = {}): Promise<CreateLobbyResult> {
  const type = options.type ?? "PRIVATE";
  const host = await ensureGuest();
  const lobby = await withUniqueRoomCode(secureRng, (code) => insertLobby(code, host.id, type));

  const room = await openRoom({ lobbyId: lobby.id, code: lobby.code, hostUserId: host.id });
  if (room.ok) return { ok: true, code: lobby.code };

  // A failed delete leaves a WAITING row; cleanup of stale lobbies is card 145.
  await db.lobby.delete({ where: { id: lobby.id } }).catch(() => undefined);
  return { ok: false, error: "race-server-unavailable" };
}

// null = code already taken (unique index), so the caller draws again.
async function insertLobby(code: RoomCode, hostUserId: string, type: LobbyType) {
  try {
    const row = await db.lobby.create({
      data: { code, hostUserId, type },
      select: { id: true, code: true },
    });
    return { id: row.id, code: row.code as RoomCode };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      return null;
    throw error;
  }
}
