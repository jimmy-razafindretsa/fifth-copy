"use server";

import { parseRoomCode, PROTOCOL_VERSION } from "@fifth-copy/protocol";
import { env } from "@/env";
import { ensureGuest, getAvatarUser, getViewer } from "@/features/identity";
import { isGuestSubject, limit, limitCode, requestSubject } from "@/server/limiter";
import { signRaceToken } from "@/server/race-token";
import { codeProofStore } from "@/server/room-code-proof";
import { findLobbyByCode } from "../queries/get-lobby-by-code";
import { roleFor } from "../role";
import { mintRaceTokenInputSchema } from "../schema";
import type { RaceTokenResult } from "../types";

// Mints the viewer's 5-minute race token for a lobby (ADR 0009: fetched by an action, never in
// URLs). In the MVP the code is the secret: anyone holding it may join. The lobby is looked up
// first so a bad code never creates a guest; an unparsable input is `not-found`. `spectator: true`
// mints a read-only `spectator` token for any viewer, the host included (#187). The
// limit is checked first (#207, #699): `mint-race-token` per guest, or, without a guest cookie (a
// student's first mint), per (IP, code) plus the IP's distinct-code budget, so a class behind one
// address can all get a token. A refused call reads nothing and creates no guest.
// #999 C13: a mint is a proof of the code, so a minted viewer's `web:code-proof:<viewer>:<lobby>` is
// written (24 h, best effort: the mint stands on the code it was given) and `getRaceSeat` serves this
// viewer the code afterwards. `lobbyId`, when given, must be the code's lobby (`not-found` otherwise).
// A CLOSED room mints nothing, except a `spectator` token for its host or for a viewer who proved the
// code before (a projector reloaded while the race still runs, #999 M3a); the race server answers a
// room that is gone.
export async function mintRaceToken(input: {
  /** `null` never mints (`not-found`): the type is the race page's `MintRaceToken` (#999 C12). */
  code: string | null;
  spectator?: boolean;
  lobbyId?: string;
}): Promise<RaceTokenResult> {
  const parsed = mintRaceTokenInputSchema.safeParse(input);
  const code = parsed.success ? parseRoomCode(parsed.data.code) : null;
  const subject = await requestSubject();
  const verdict = isGuestSubject(subject)
    ? await limit("mint-race-token", subject)
    : await limitCode("mint-race-token-new-guest", subject, code);
  if (!verdict.ok) return { ok: false, error: "rate-limited" };
  const lobby = code ? await findLobbyByCode(code) : null;
  if (!lobby) return { ok: false, error: "not-found" };
  if (parsed.data?.lobbyId !== undefined && parsed.data.lobbyId !== lobby.id) {
    return { ok: false, error: "not-found" };
  }
  if (lobby.status !== "WAITING" && !(parsed.data?.spectator && (await mayRewatch(lobby)))) {
    return { ok: false, error: "closed" };
  }

  const viewer = await ensureGuest();
  await codeProofStore().record(viewer.id, lobby.id);
  // #730: the roll's portrait is addressed with the approved avatar's version (display data only;
  // the avatar route still decides who may see it, ADR 0014, 0022). No picture reads no row.
  const { avatarVersion } = await getAvatarUser(viewer);
  const token = await signRaceToken(
    {
      v: PROTOCOL_VERSION,
      sub: viewer.id,
      name: viewer.name,
      lobby: lobby.id,
      role: roleFor(lobby, viewer.id, { spectator: parsed.data?.spectator }),
      avatar: avatarVersion,
    },
    { secret: env.RACE_TOKEN_SECRET },
  );
  return { ok: true, token, url: env.NEXT_PUBLIC_RACE_SERVER_URL };
}

/** A closed room's spectator (#999): its host, or a viewer already holding the code proof. No guest is created. */
async function mayRewatch(lobby: { id: string; hostUserId: string }): Promise<boolean> {
  const viewer = await getViewer();
  if (!viewer) return false;
  return viewer.id === lobby.hostUserId || codeProofStore().holds(viewer.id, lobby.id);
}
