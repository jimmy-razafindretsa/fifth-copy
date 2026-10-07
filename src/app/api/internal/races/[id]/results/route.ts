import {
  PROTOCOL_VERSION,
  raceResultsRequestSchema,
  type InternalError,
} from "@fifth-copy/protocol";
import { env } from "@/env";
import { MAX_RESULTS_BODY_BYTES, persistRaceResults } from "@/features/results";
import { requireInternal } from "@/server/internal-api/verify";

const refuse = (status: number, error: InternalError["error"]) =>
  Response.json({ v: PROTOCOL_VERSION, error } satisfies InternalError, { status });

/**
 * `POST /api/internal/races/:id/results` (race server -> web at race end, ADR 0008, ARCHITECTURE
 * 9.3): verify the HMAC, parse the protocol schema (the path id must be the body's `raceId`), then
 * `persistRaceResults` stores the chunk in one transaction, idempotent per (race, desk). Refusals:
 * 401 bad-signature / stale-timestamp, 400 bad-body, 426 version, 404 not-found. Any other failure
 * is a bare 500 (the race server retries). Never logs a body or an error detail.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const verified = await requireInternal(request, {
    secret: env.RACE_TOKEN_SECRET,
    maxBodyBytes: MAX_RESULTS_BODY_BYTES,
  });
  if (!verified.ok) return refuse(verified.status, verified.error);
  const parsed = raceResultsRequestSchema.safeParse(verified.body);
  const { id } = await ctx.params;
  if (!parsed.success || parsed.data.raceId !== id) return refuse(400, "bad-body");
  try {
    const result = await persistRaceResults(parsed.data);
    if (!result.ok) return refuse(result.error === "not-found" ? 404 : 400, result.error);
    return Response.json(result.response);
  } catch {
    console.error(
      JSON.stringify({ level: "error", msg: "internal", path: "/api/internal/races/:id/results" }),
    );
    return new Response(null, { status: 500 });
  }
}
