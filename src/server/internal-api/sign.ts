import "server-only";
import { createHmac } from "node:crypto";
import { INTERNAL_HEADERS } from "@fifth-copy/protocol";

// Lowercase hex HMAC-SHA256 over `${timestamp}.${rawBody}` keyed by RACE_TOKEN_SECRET (ADR 0006).
// Sign the exact string that is sent: re-serialising the body would change the bytes.
export function signInternalBody({
  timestamp,
  rawBody,
  secret,
}: {
  timestamp: string;
  rawBody: string;
  secret: string;
}): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

// Headers of a signed internal request; `now` is unix seconds.
export function internalHeaders({
  rawBody,
  secret,
  now = Math.floor(Date.now() / 1000),
}: {
  rawBody: string;
  secret: string;
  now?: number;
}): Record<string, string> {
  const timestamp = String(now);
  return {
    [INTERNAL_HEADERS.timestamp]: timestamp,
    [INTERNAL_HEADERS.signature]: signInternalBody({ timestamp, rawBody, secret }),
  };
}
