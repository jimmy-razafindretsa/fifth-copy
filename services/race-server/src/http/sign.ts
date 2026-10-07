import { createHmac } from "node:crypto";
import { INTERNAL_HEADERS } from "@fifth-copy/protocol";

/**
 * Race server -> web signer (ADR 0006 point 6), the mirror of the web's `src/server/internal-api/sign.ts`
 * (services never import src/; protocol cannot hold node:crypto). Lowercase hex HMAC-SHA256 over
 * `${timestamp}.${rawBody}` keyed by RACE_TOKEN_SECRET. Sign the exact bytes that are sent.
 */
export function signInternalBody(input: {
  timestamp: string;
  rawBody: string;
  secret: string;
}): string {
  return createHmac("sha256", input.secret)
    .update(`${input.timestamp}.${input.rawBody}`)
    .digest("hex");
}

/** Headers of a signed internal request; `nowMs` is the server clock (ms epoch). */
export function internalHeaders(input: {
  rawBody: string;
  secret: string;
  nowMs: number;
}): Record<string, string> {
  const timestamp = String(Math.floor(input.nowMs / 1000));
  return {
    [INTERNAL_HEADERS.timestamp]: timestamp,
    [INTERNAL_HEADERS.signature]: signInternalBody({
      timestamp,
      rawBody: input.rawBody,
      secret: input.secret,
    }),
  };
}
