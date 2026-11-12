import "server-only";
import type { RoomCode } from "@fifth-copy/protocol";
import { createLobby } from "../actions/create-lobby";
import { pickRoom } from "../pick-room";
import { quickRaceBots } from "../practice";
import { listOpenLobbies } from "../queries/list-open-lobbies";
import type { QuickRaceResult } from "../types";

/**
 * QUICK RACE's choice (#128, spec 5.3, ADR 0008): the room `pickRoom` takes from the open public
 * rooms, else a new public room seated with `quickRaceBots(rng)`, the caller its host. A failed or
 * throwing lookup still tries to create (the visitor races the bots); a failed create is the answer.
 * `rng` is injected (a draw in [0, 1)) so tests seed the fill; the action passes the server's.
 */
export async function runQuickRace(rng: () => number): Promise<QuickRaceResult> {
  const open = await listOpenLobbies().catch(() => null);
  const room = open?.ok ? pickRoom(open.lobbies) : null;
  // OpenLobby carries the code as read from the Lobby row, which only ever holds a RoomCode.
  if (room) return { ok: true, code: room.code as RoomCode, joined: true };

  const created = await createLobby({
    settings: { lobbyType: "public", bots: quickRaceBots(rng) },
  });
  return created.ok ? { ok: true, code: created.code, joined: false } : created;
}
