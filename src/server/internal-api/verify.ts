import "server-only";
import { timingSafeEqual } from "node:crypto";
import {
  INTERNAL_HEADERS,
  INTERNAL_MAX_SKEW_S,
  PROTOCOL_VERSION,
  type InternalError,
} from "@fifth-copy/protocol";
import { signInternalBody } from "./sign";

/** Internal request bodies are small JSON objects; anything larger is refused before hashing. */
export const MAX_INTERNAL_BODY_BYTES = 64 * 1024;

const HEX_SHA256 = /^[0-9a-f]{64}$/;
const UNIX_SECONDS = /^[0-9]{1,12}$/;

export type InternalRefusal = {
  ok: false;
  status: 400 | 401 | 426;
  error: Extract<
    InternalError["error"],
    "bad-signature" | "stale-timestamp" | "bad-body" | "version"
  >;
};
export type InternalVerified = { ok: true; body: Record<string, unknown> };

/** Reads at most `max` bytes of the body; null when it is larger (the rest is never buffered). */
async function readCapped(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Verifies a race server -> web internal request (ADR 0006 point 6), with the race server's rules
 * and order (`services/race-server/src/http/internal.ts`): raw body capped at 64 KiB (400 `bad-body`),
 * timestamp format and skew (401 `stale-timestamp`), HMAC-SHA256 hex over `${timestamp}.${rawBody}`
 * compared in constant time (401 `bad-signature`), JSON object (400 `bad-body`), then `v` (426
 * `version`). The caller parses `body` with its protocol schema. Nothing here logs.
 */
export async function requireInternal(
  request: Request,
  { secret, nowMs = Date.now() }: { secret: string; nowMs?: number },
): Promise<InternalVerified | InternalRefusal> {
  const rawBody = await readCapped(request, MAX_INTERNAL_BODY_BYTES);
  if (rawBody === null) return { ok: false, status: 400, error: "bad-body" };

  const timestamp = request.headers.get(INTERNAL_HEADERS.timestamp);
  if (!timestamp || !UNIX_SECONDS.test(timestamp)) {
    return { ok: false, status: 401, error: "stale-timestamp" };
  }
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > INTERNAL_MAX_SKEW_S) {
    return { ok: false, status: 401, error: "stale-timestamp" };
  }
  const signature = request.headers.get(INTERNAL_HEADERS.signature);
  if (!signature || !HEX_SHA256.test(signature)) {
    return { ok: false, status: 401, error: "bad-signature" };
  }
  const expected = Buffer.from(signInternalBody({ timestamp, rawBody, secret }), "hex");
  const given = Buffer.from(signature, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, status: 401, error: "bad-signature" };
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { ok: false, status: 400, error: "bad-body" };
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, status: 400, error: "bad-body" };
  }
  if ((body as { v?: unknown }).v !== PROTOCOL_VERSION) {
    return { ok: false, status: 426, error: "version" };
  }
  return { ok: true, body: body as Record<string, unknown> };
}
