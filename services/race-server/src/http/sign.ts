import { createHmac, randomBytes } from "node:crypto";
import { INTERNAL_HEADERS, internalSignedString } from "@fifth-copy/protocol";

/**
 * Race server -> web signer (ADR 0006 point 6), the mirror of the web's `src/server/internal-api/sign.ts`
 * (services never import src/; protocol cannot hold node:crypto). Lowercase hex HMAC-SHA256 over
 * `${timestamp}.${nonce}.${rawBody}` keyed by RACE_TOKEN_SECRET (#518). Sign the exact bytes that are sent.
 */
export function signInternalBody(input: {
  timestamp: string;
  nonce: string;
  rawBody: string;
  secret: string;
}): string {
  return createHmac("sha256", input.secret).update(internalSignedString(input)).digest("hex");
}

/**
 * Headers of a signed internal request; `nowMs` is the server clock (ms epoch). `nonce` is fresh
 * (16 random bytes hex) per call unless a test injects one.
 */
export function internalHeaders(input: {
  rawBody: string;
  secret: string;
  nowMs: number;
  nonce?: string;
}): Record<string, string> {
  const timestamp = String(Math.floor(input.nowMs / 1000));
  const nonce = input.nonce ?? randomBytes(16).toString("hex");
  return {
    [INTERNAL_HEADERS.timestamp]: timestamp,
    [INTERNAL_HEADERS.nonce]: nonce,
    [INTERNAL_HEADERS.signature]: signInternalBody({
      timestamp,
      nonce,
      rawBody: input.rawBody,
      secret: input.secret,
    }),
  };
}
