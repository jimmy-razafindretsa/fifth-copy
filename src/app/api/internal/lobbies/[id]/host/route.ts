import {
  setLobbyHostRequestSchema,
  PROTOCOL_VERSION,
  type SetLobbyHostResponse,
  type InternalError,
} from "@fifth-copy/protocol";
import { env } from "@/env";
import { setLobbyHost } from "@/features/lobby/server";
import { webNonceStore } from "@/server/internal-api/nonces";
import { internalRefusalResponse, requireInternal } from "@/server/internal-api/verify";

const refuse = (status: number, error: InternalError["error"]) =>
  Response.json({ v: PROTOCOL_VERSION, error } satisfies InternalError, { status });

/** Same printable rule as the protocol's names and keys (#557): ids reach Postgres as text. */
const UNPRINTABLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/u;

/**
 * `POST /api/internal/lobbies/:id/host` (race server -> web when the room promoted a new host, #137,
 * ADR 0006 point 6, ADR 0008): verify the HMAC and nonce, parse the protocol schema (the path id must
 * be the body's `lobbyId`), then `setLobbyHost` records the promoted user as `Lobby.hostUserId`
 * (idempotent: the same host answers `changed: false`). Refusals: 401 bad-signature /
 * stale-timestamp / replay, 400 bad-body, 426 version, 404 not-found (unknown lobby or a host id that
 * is no `User`); a bare 503 when the nonce store is unavailable, a bare 500 on any other failure (the
 * race server's outbox retries). Never logs a body or an error detail.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const verified = await requireInternal(request, {
    secret: env.RACE_TOKEN_SECRET,
    nonces: webNonceStore(),
  });
  if (!verified.ok) return internalRefusalResponse(verified);
  const parsed = setLobbyHostRequestSchema.safeParse(verified.body);
  const { id } = await ctx.params;
  if (
    !parsed.success ||
    parsed.data.lobbyId !== id ||
    UNPRINTABLE.test(id) ||
    UNPRINTABLE.test(parsed.data.hostUserId)
  ) {
    return refuse(400, "bad-body");
  }
  try {
    const result = await setLobbyHost(id, parsed.data.hostUserId);
    if (!result.ok) return refuse(404, result.error);
    return Response.json({
      v: PROTOCOL_VERSION,
      lobbyId: id,
      changed: result.changed,
    } satisfies SetLobbyHostResponse);
  } catch {
    console.error(
      JSON.stringify({ level: "error", msg: "internal", path: "/api/internal/lobbies/:id/host" }),
    );
    return new Response(null, { status: 500 });
  }
}
