import { createHmac, timingSafeEqual } from "node:crypto";
import { INTERNAL_MAX_SKEW_S } from "@fifth-copy/protocol";

export type VerifyInternalResult =
  { ok: true } | { ok: false; error: "stale-timestamp" | "bad-signature" };

const HEX_SHA256 = /^[0-9a-f]{64}$/;
const UNIX_SECONDS = /^[0-9]{1,12}$/;

/**
 * Verifies an internal API request (ADR 0006 point 6): HMAC-SHA256 hex over `${timestamp}.${rawBody}`
 * keyed by RACE_TOKEN_SECRET, timestamp within INTERNAL_MAX_SKEW_S of the injected clock. Pure; the
 * comparison is constant-time and nothing here logs.
 */
export function verifyInternalRequest(input: {
  secret: string;
  timestamp: string | undefined;
  signature: string | undefined;
  rawBody: string;
  nowMs: number;
}): VerifyInternalResult {
  const { secret, timestamp, signature, rawBody, nowMs } = input;
  if (!timestamp || !UNIX_SECONDS.test(timestamp)) return { ok: false, error: "stale-timestamp" };
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > INTERNAL_MAX_SKEW_S) {
    return { ok: false, error: "stale-timestamp" };
  }
  if (!signature || !HEX_SHA256.test(signature)) return { ok: false, error: "bad-signature" };
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest();
  const given = Buffer.from(signature, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected)
    ? { ok: true }
    : { ok: false, error: "bad-signature" };
}
