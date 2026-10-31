import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { INTERNAL_HEADERS, internalSignedString } from "@fifth-copy/protocol";

// Lowercase hex HMAC-SHA256 over `${timestamp}.${nonce}.${rawBody}` keyed by RACE_TOKEN_SECRET
// (ADR 0006, #518). Sign the exact string that is sent: re-serialising the body would change the bytes.
export function signInternalBody({
  timestamp,
  nonce,
  rawBody,
  secret,
}: {
  timestamp: string;
  nonce: string;
  rawBody: string;
  secret: string;
}): string {
  return createHmac("sha256", secret)
    .update(internalSignedString({ timestamp, nonce, rawBody }))
    .digest("hex");
}

// Headers of a signed internal request; `now` is unix seconds. `nonce` is fresh (16 random bytes hex)
// per call unless a test injects one.
export function internalHeaders({
  rawBody,
  secret,
  now = Math.floor(Date.now() / 1000),
  nonce = randomBytes(16).toString("hex"),
}: {
  rawBody: string;
  secret: string;
  now?: number;
  nonce?: string;
}): Record<string, string> {
  const timestamp = String(now);
  return {
    [INTERNAL_HEADERS.timestamp]: timestamp,
    [INTERNAL_HEADERS.nonce]: nonce,
    [INTERNAL_HEADERS.signature]: signInternalBody({ timestamp, nonce, rawBody, secret }),
  };
}
