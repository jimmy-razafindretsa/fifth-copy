"use server";

import { parseRoomCode, PROTOCOL_VERSION } from "@fifth-copy/protocol";
import { env } from "@/env";
import { ensureGuest } from "@/features/identity";
import { signRaceToken } from "@/server/race-token";
import { findLobbyByCode } from "../queries/get-lobby-by-code";
import { roleFor } from "../role";
import { mintRaceTokenInputSchema } from "../schema";
import type { RaceTokenResult } from "../types";

// Mints the viewer's 5-minute race token for a lobby (ADR 0009: fetched by an action, never in
// URLs). In the MVP the code is the secret: anyone holding it may join. The lobby is looked up
// first so a bad code never creates a guest; an unparsable input is `not-found`. `spectator: true`
// mints a read-only `spectator` token for any viewer, the host included (#187).
export async function mintRaceToken(input: {
  code: string;
  spectator?: boolean;
}): Promise<RaceTokenResult> {
  const parsed = mintRaceTokenInputSchema.safeParse(input);
  const code = parsed.success ? parseRoomCode(parsed.data.code) : null;
  const lobby = code ? await findLobbyByCode(code) : null;
  if (!lobby) return { ok: false, error: "not-found" };
  if (lobby.status !== "WAITING") return { ok: false, error: "closed" };

  const viewer = await ensureGuest();
  const token = await signRaceToken(
    {
      v: PROTOCOL_VERSION,
      sub: viewer.id,
      name: viewer.name,
      lobby: lobby.id,
      role: roleFor(lobby, viewer.id, { spectator: parsed.data?.spectator }),
    },
    { secret: env.RACE_TOKEN_SECRET },
  );
  return { ok: true, token, url: env.NEXT_PUBLIC_RACE_SERVER_URL };
}
