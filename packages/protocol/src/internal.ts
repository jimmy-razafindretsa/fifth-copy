import { z } from "zod";
import { roomCodeSchema } from "./room-code";
import { raceSettingsSchema } from "./settings";
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
  /** The host's validated settings; stored in the room hash on first open. */
  settings: raceSettingsSchema,
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
  body:
    '{"v":3,"lobbyId":"lob_test","code":"KGB-4821","hostUserId":"usr_test","settings":' +
    '{"language":"en","textType":"sentences","wordCount":50,"accentEveryWord":false,' +
    '"difficulty":{"level":"normal"},"practiceLetters":[],"includeNumbers":false,' +
    '"includeSymbols":false,"includePunctuation":true,"timerS":null,"errorMode":"continue",' +
    '"backspace":true,"bonuses":true,"bots":[],"lobbyType":"private"}}',
  signature: "0eda9a500134020de94914aa1192694751a0998d6bcb38bf60479d3179f9dc24",
} as const;
