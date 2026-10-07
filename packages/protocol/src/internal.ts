import { z } from "zod";
import {
  bonusKindSchema,
  deskSchema,
  endReasonSchema,
  idSchema,
  MAX_DESKS,
  msSchema,
  nameSchema,
  playerStatusSchema,
  raceIdSchema,
  raceTextSchema,
  ratioSchema,
  wordCountSchema,
  wpmSchema,
} from "./race";
import { roomCodeSchema } from "./room-code";
import { raceLanguageSchema, raceSettingsSchema } from "./settings";
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

/**
 * `POST /api/internal/races` (race server -> web, on `host:start`): create the Race row and pick the
 * text. Idempotent on `raceId`. The web stamps its own `ENGINE_VERSION` (same deploy, ADR 0012).
 */
export const startRaceRequestSchema = z.object({
  v: versionSchema,
  raceId: raceIdSchema,
  lobbyId: idSchema,
  hostUserId: idSchema,
  settings: raceSettingsSchema,
  /** Every seated desk at start; bots have no user. */
  desks: z
    .array(
      z.object({
        desk: deskSchema,
        userId: idSchema.nullable(),
        name: nameSchema,
        isBot: z.boolean(),
      }),
    )
    .min(1)
    .max(MAX_DESKS),
});
export type StartRaceRequest = z.infer<typeof startRaceRequestSchema>;

export const startRaceResponseSchema = z.object({
  v: versionSchema,
  raceId: raceIdSchema,
  text: z.object({
    content: raceTextSchema,
    language: raceLanguageSchema,
    wordCount: wordCountSchema,
    sourceRef: z.string().min(1).max(256).nullable(),
  }),
  settings: raceSettingsSchema,
  /** Server ms epoch. */
  startedAt: msSchema,
});
export type StartRaceResponse = z.infer<typeof startRaceResponseSchema>;

/** Results per `POST /api/internal/races/:id/results` call. */
export const MAX_RESULTS_PER_REQUEST = 25;
/** gzip+base64 keystroke trace of one desk (ADR 0008); 256 KiB of base64 is ~ an hour of typing. */
export const MAX_TRACE_BASE64_LENGTH = 256 * 1024;

const counter = z.int().min(0);

/**
 * One desk's final result. `status` is the engine's: `typing` at the end means timed out (mapping to
 * the stored result status is the web's). `durationMs`/`finishedAtMs` are ms since GO.
 */
export const internalRaceResultSchema = z.object({
  desk: deskSchema,
  userId: idSchema.nullable(),
  name: nameSchema,
  isBot: z.boolean(),
  place: deskSchema,
  status: playerStatusSchema,
  wpm: wpmSchema,
  rawWpm: wpmSchema,
  cleanWpm: wpmSchema,
  adjustedWpm: wpmSchema,
  accuracy: ratioSchema,
  progress: ratioSchema,
  correct: counter,
  errors: counter,
  total: counter,
  durationMs: msSchema,
  finishedAtMs: msSchema.nullable(),
  bonusesSent: counter,
  bonusesReceived: counter,
  bonusLog: z
    .array(z.object({ t: msSchema, kind: bonusKindSchema, from: deskSchema, to: deskSchema }))
    .max(1024),
  /** Anti-cheat flags (ARCHITECTURE 7.7). */
  flags: z
    .array(z.object({ code: z.string().min(1).max(64), detail: z.string().max(256).optional() }))
    .max(32),
  engineVersion: z.string().min(1).max(32),
  trace: z.object({
    encoding: z.literal("gzip+base64"),
    data: z.base64().max(MAX_TRACE_BASE64_LENGTH),
    count: counter,
  }),
});
export type InternalRaceResult = z.infer<typeof internalRaceResultSchema>;

/**
 * `POST /api/internal/races/:id/results` (race server -> web, at race end, ARCHITECTURE 9.3).
 * Idempotent per (race, desk); a void race is never sent.
 */
export const raceResultsRequestSchema = z.object({
  v: versionSchema,
  raceId: raceIdSchema,
  /** Server ms epoch. */
  endedAt: msSchema,
  reason: endReasonSchema.exclude(["void"]),
  lobbySize: z.int().min(1).max(MAX_DESKS),
  results: z.array(internalRaceResultSchema).min(1).max(MAX_RESULTS_PER_REQUEST),
});
export type RaceResultsRequest = z.infer<typeof raceResultsRequestSchema>;

export const raceResultsResponseSchema = z.object({
  v: versionSchema,
  raceId: raceIdSchema,
  /** Desks whose result is stored (now or by an earlier call). */
  persisted: z.array(deskSchema).max(MAX_RESULTS_PER_REQUEST),
});
export type RaceResultsResponse = z.infer<typeof raceResultsResponseSchema>;

export const internalErrorSchema = z.object({
  v: versionSchema,
  error: z.enum([
    "bad-signature",
    "stale-timestamp",
    "bad-body",
    "version",
    "not-found",
    "conflict",
  ]),
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
    '{"v":4,"lobbyId":"lob_test","code":"KGB-4821","hostUserId":"usr_test","settings":' +
    '{"language":"en","textType":"sentences","wordCount":50,"accentEveryWord":false,' +
    '"difficulty":{"level":"normal"},"practiceLetters":[],"includeNumbers":false,' +
    '"includeSymbols":false,"includePunctuation":true,"timerS":null,"errorMode":"continue",' +
    '"backspace":true,"bonuses":true,"bots":[],"lobbyType":"private"}}',
  signature: "a26389c21e37ff097cb3903faf25aa90d3489d5504c050adb3b6fe1888e8dfda",
} as const;
