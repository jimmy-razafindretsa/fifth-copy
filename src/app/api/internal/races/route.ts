import { PROTOCOL_VERSION, startRaceRequestSchema, type InternalError } from "@fifth-copy/protocol";
import { env } from "@/env";
import { startRace } from "@/features/results";
import { requireInternal } from "@/server/internal-api/verify";

const refuse = (status: number, error: InternalError["error"]) =>
  Response.json({ v: PROTOCOL_VERSION, error } satisfies InternalError, { status });

/**
 * `POST /api/internal/races` (race server -> web on `host:start`, ADR 0006 point 6): verify the HMAC,
 * parse the protocol schema, then `startRace` creates the Race row with its text (idempotent on
 * `raceId`). Refusals: 401 bad-signature / stale-timestamp, 400 bad-body, 426 version, 404 not-found,
 * 409 conflict. Never logs a body.
 */
export async function POST(request: Request) {
  const verified = await requireInternal(request, { secret: env.RACE_TOKEN_SECRET });
  if (!verified.ok) return refuse(verified.status, verified.error);
  const parsed = startRaceRequestSchema.safeParse(verified.body);
  if (!parsed.success) return refuse(400, "bad-body");
  const result = await startRace(parsed.data);
  if (!result.ok) return refuse(result.error === "not-found" ? 404 : 409, result.error);
  return Response.json(result.response);
}
