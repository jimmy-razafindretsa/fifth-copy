"use server";

import { raceSettingsPatchSchema } from "@fifth-copy/protocol";
import { DEFAULT_PRACTICE_BOTS } from "../practice";
import type { CreateLobbyResult } from "../types";
import { createLobby } from "./create-lobby";

/**
 * Solo practice against bots (#367, spec 5.2, R64, R65): a private lobby already seated with bots, the
 * caller its host. Bots are server-side participants like in every race (ADR 0006, 0007); there is no
 * offline path. `partial` is any race settings patch (untrusted, parsed here; `lobbyType` is refused,
 * the room is always private), so #329 can open practice on chosen letters. Invalid input creates
 * nothing; otherwise it is `createLobby` (guest, room on the race server, same result).
 */
export async function createPracticeLobby(partial: unknown = {}): Promise<CreateLobbyResult> {
  const patch = raceSettingsPatchSchema.safeParse(partial);
  if (!patch.success) return { ok: false, error: "invalid-settings" };
  return createLobby({
    settings: {
      ...patch.data,
      lobbyType: "private",
      bots: patch.data.bots ?? DEFAULT_PRACTICE_BOTS,
    },
  });
}
