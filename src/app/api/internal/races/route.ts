import {
  PROTOCOL_VERSION,
  startRaceRequestSchema,
  type InternalError,
  type StartRaceRequest,
} from "@fifth-copy/protocol";
import { env } from "@/env";
import { startRace } from "@/features/results";
import { requireInternal } from "@/server/internal-api/verify";

const refuse = (status: number, error: InternalError["error"]) =>
  Response.json({ v: PROTOCOL_VERSION, error } satisfies InternalError, { status });

/** Same printable rule as the protocol's names and keys (#557): ids reach Postgres as text. */
const UNPRINTABLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/u;
const printableIds = (req: StartRaceRequest) =>
  [req.lobbyId, req.hostUserId, ...req.desks.map((d) => d.userId ?? "")].every(
    (id) => !UNPRINTABLE.test(id),
  );

/**
 * `POST /api/internal/races` (race server -> web on `host:start`, ADR 0006 point 6): verify the HMAC,
 * parse the protocol schema, then `startRace` creates the Race row with its text (idempotent on
 * `raceId`). Refusals: 401 bad-signature / stale-timestamp, 400 bad-body, 426 version, 404 not-found,
 * 409 conflict. Any other failure is a bare 500. Never logs a body or an error detail.
 */
export async function POST(request: Request) {
  const verified = await requireInternal(request, { secret: env.RACE_TOKEN_SECRET });
  if (!verified.ok) return refuse(verified.status, verified.error);
  const parsed = startRaceRequestSchema.safeParse(verified.body);
  if (!parsed.success || !printableIds(parsed.data)) return refuse(400, "bad-body");
  try {
    const result = await startRace(parsed.data);
    if (!result.ok) return refuse(result.error === "not-found" ? 404 : 409, result.error);
    return Response.json(result.response);
  } catch {
    console.error(JSON.stringify({ level: "error", msg: "internal", path: "/api/internal/races" }));
    return new Response(null, { status: 500 });
  }
}
