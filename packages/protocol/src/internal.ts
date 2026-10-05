import { z } from "zod";
import { roomCodeSchema } from "./room-code";
import { versionSchema } from "./version";

/**
 * Web <-> race server internal HTTP API (ADR 0006). Each request carries a unix-seconds timestamp
 * and a lowercase hex HMAC-SHA256 over `${timestamp}.${rawBody}`, keyed by `RACE_TOKEN_SECRET`.
 * The receiver rejects a timestamp more than `INTERNAL_MAX_SKEW_S` away from its clock.
 */
export const INTERNAL_HEADERS = {
  timestamp: "x-fc-timestamp",
  signature: "x-fc-signature",
} as const;

export const INTERNAL_MAX_SKEW_S = 300;

/** `POST /internal/rooms` (web -> race server): open the waiting room of a lobby. Idempotent. */
export const openRoomRequestSchema = z.object({
  v: versionSchema,
  lobbyId: z.string().min(1),
  code: roomCodeSchema,
  hostUserId: z.string().min(1),
});
export type OpenRoomRequest = z.infer<typeof openRoomRequestSchema>;

export const openRoomResponseSchema = z.object({
  v: versionSchema,
  roomId: z.string().min(1),
  phase: z.literal("waiting"),
  created: z.boolean(),
});
export type OpenRoomResponse = z.infer<typeof openRoomResponseSchema>;

export const internalErrorSchema = z.object({
  v: versionSchema,
  error: z.enum(["bad-signature", "stale-timestamp", "bad-body", "version"]),
});
export type InternalError = z.infer<typeof internalErrorSchema>;

/**
 * Known-answer vector, computed once with Node `crypto`, so the web signer and the race-server
 * verifier are tested against the same bytes without importing each other.
 */
export const INTERNAL_HMAC_TEST_VECTOR = {
  secret: "test-secret-for-internal-hmac-vector-0123456789",
  timestamp: "1767225600",
  body: '{"v":2,"lobbyId":"lob_test","code":"KGB-4821","hostUserId":"usr_test"}',
  signature: "4e8572b0f66b10adf8a0b1a64f4477743c8782f379731f21369790ac52fcd6f9",
} as const;
