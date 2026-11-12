import { z } from "zod";
import {
  bonusKindSchema,
  deskSchema,
  endReasonSchema,
  idSchema,
  MAX_DESKS,
  msSchema,
  raceMsSchema,
  nameSchema,
  phaseSchema,
  playerStatusSchema,
  raceIdSchema,
  raceTextSchema,
  ratioSchema,
  textOverlaySchema,
  wordCountSchema,
  wpmSchema,
} from "./race";
import { roomCodeSchema } from "./room-code";
import { raceLanguageSchema, raceSettingsSchema } from "./settings";
import { versionSchema } from "./version";

/**
 * Web <-> race server internal HTTP API (ADR 0006). Each request, in both directions, carries a
 * unix-seconds timestamp, a nonce (`INTERNAL_NONCE_HEX`, 16 random bytes, fresh per request) and a
 * lowercase hex HMAC-SHA256 over `internalSignedString` = `${timestamp}.${nonce}.${rawBody}`, keyed by
 * `RACE_TOKEN_SECRET`. The receiver rejects a timestamp more than `INTERNAL_MAX_SKEW_S` away from its
 * clock (401 `stale-timestamp`) and a missing or malformed nonce (401 `bad-signature`). Both receivers
 * remember each correctly signed nonce for `INTERNAL_NONCE_TTL_S` and refuse its reuse (401 `replay`):
 * the race server since #518, the web since #716 (a bare 503 when its store is unavailable).
 */
export const INTERNAL_HEADERS = {
  timestamp: "x-fc-timestamp",
  signature: "x-fc-signature",
  nonce: "x-fc-nonce",
} as const;

export const INTERNAL_MAX_SKEW_S = 300;

/** A request nonce: 32 lowercase hex characters (16 random bytes). */
export const INTERNAL_NONCE_HEX = /^[0-9a-f]{32}$/;

/**
 * How long a used nonce is remembered. A timestamp is accepted within +-`INTERNAL_MAX_SKEW_S`, so a
 * captured request stays acceptable for a span of twice the skew; the nonce must outlive it.
 */
export const INTERNAL_NONCE_TTL_S = 2 * INTERNAL_MAX_SKEW_S;

/** The exact string both signers HMAC and both verifiers recompute. Sign the bytes that are sent. */
export function internalSignedString(input: {
  timestamp: string;
  nonce: string;
  rawBody: string;
}): string {
  return `${input.timestamp}.${input.nonce}.${input.rawBody}`;
}

/** `POST /internal/rooms` (web -> race server): open the waiting room of a lobby. Idempotent. */
export const openRoomRequestSchema = z.object({
  v: versionSchema,
  lobbyId: idSchema,
  code: roomCodeSchema,
  hostUserId: idSchema,
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

/** Lobby ids per `POST /internal/rooms/status` call (#806): the open-rooms list asks for at most 50. */
export const MAX_ROOM_STATUS_IDS = 50;

/**
 * `POST /internal/rooms/status` (web -> race server, #806): which of these lobbies have a live room,
 * in which phase, and how many desks are taken. Read only; an id with no room is left out.
 */
export const roomStatusRequestSchema = z.object({
  v: versionSchema,
  lobbyIds: z.array(idSchema).min(1).max(MAX_ROOM_STATUS_IDS),
});
export type RoomStatusRequest = z.infer<typeof roomStatusRequestSchema>;

const deskCountSchema = z.int().min(0).max(MAX_DESKS);

/**
 * One live room: counts only, never names, user ids or settings. Extension point: later fields
 * (language, host name) are additive.
 */
export const roomStatusSchema = z.object({
  lobbyId: idSchema,
  phase: phaseSchema,
  /** Human desks seated. */
  typists: deskCountSchema,
  /** Bot desks seated. */
  bots: deskCountSchema,
  /** Desks the room holds, typists and bots together (`ROOM_SEATS`). */
  seats: z.int().min(1).max(MAX_DESKS),
});
export type RoomStatus = z.infer<typeof roomStatusSchema>;

export const roomStatusResponseSchema = z.object({
  v: versionSchema,
  rooms: z.array(roomStatusSchema).max(MAX_ROOM_STATUS_IDS),
});
export type RoomStatusResponse = z.infer<typeof roomStatusResponseSchema>;

/**
 * `POST /internal/rooms/type` (web -> race server, #815): the host filed PUBLIC or PRIVATE. Postgres
 * owns `Lobby.type` (ADR 0008); the web asks the room first and writes the row only on `ok`, and the
 * room's `settings.lobbyType` follows. Extension point: one Postgres-owned setting per request.
 */
export const roomTypeRequestSchema = z.object({
  v: versionSchema,
  lobbyId: idSchema,
  lobbyType: raceSettingsSchema.shape.lobbyType,
});
export type RoomTypeRequest = z.infer<typeof roomTypeRequestSchema>;

/** `ok` (filed, or already the stored value); `not-waiting` (the race left `waiting`); `no-room`. */
export const roomTypeResponseSchema = z.object({
  v: versionSchema,
  result: z.enum(["ok", "no-room", "not-waiting"]),
});
export type RoomTypeResponse = z.infer<typeof roomTypeResponseSchema>;

/**
 * `POST /internal/rooms/shared` (web -> race server, #65, ADR 0022): are these two users members of
 * the same live room? Two different user ids in, one boolean out. Read only. The race server owns
 * live membership (ADR 0008); the web asks and never reads a room key.
 */
export const sharedRoomRequestSchema = z.object({
  v: versionSchema,
  userIds: z
    .tuple([idSchema, idSchema])
    .refine(([a, b]) => a !== b, { message: "two different user ids" }),
});
export type SharedRoomRequest = z.infer<typeof sharedRoomRequestSchema>;

/**
 * The boolean alone (ADR 0022 "Minimal disclosure"): strict, so a lobby id, a code, a name, a phase
 * or a count never parses. Extension point: a later rule changes the race server, never this shape.
 */
export const sharedRoomResponseSchema = z.strictObject({
  v: versionSchema,
  shared: z.boolean(),
});
export type SharedRoomResponse = z.infer<typeof sharedRoomResponseSchema>;

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
  durationMs: raceMsSchema,
  finishedAtMs: raceMsSchema.nullable(),
  bonusesSent: counter,
  bonusesReceived: counter,
  bonusLog: z
    .array(z.object({ t: raceMsSchema, kind: bonusKindSchema, from: deskSchema, to: deskSchema }))
    .max(1024),
  /**
   * The desk's final text overlay (#623, ADR 0016): the words Extra Paperwork appended and the base
   * word indexes Exemption removed, verbatim from the desk state; `null` for a desk no text-changing
   * bonus ever hit. A replay of `trace` runs on `effectiveText(base, overlay)`, not on the base.
   */
  overlay: textOverlaySchema.nullable(),
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

/**
 * `POST /api/internal/lobbies/:id/close` (race server -> web, #734): the last human left the
 * waiting room (or the room was found gone on boot), so the `Lobby` row becomes `CLOSED` at
 * `closedAt` (server ms epoch). Idempotent: a lobby already closed answers `changed: false`. Sent
 * through the race server's outbox, retried like results.
 */
export const closeLobbyRequestSchema = z.object({
  v: versionSchema,
  lobbyId: idSchema,
  closedAt: msSchema,
});
export type CloseLobbyRequest = z.infer<typeof closeLobbyRequestSchema>;

export const closeLobbyResponseSchema = z.object({
  v: versionSchema,
  lobbyId: idSchema,
  /** True when this call wrote `CLOSED`; false when the lobby was already closed. */
  changed: z.boolean(),
});
export type CloseLobbyResponse = z.infer<typeof closeLobbyResponseSchema>;

/**
 * `POST /api/internal/lobbies/:id/host` (race server -> web, #137, ADR 0006 point 6): the room's host
 * left for good and the race server promoted `hostUserId` (the earliest-joined remaining human), so
 * the `Lobby` row's durable copy follows (ADR 0008: the room hash is the live truth, the row is what
 * the web's host-only actions read). Idempotent: the same host answers `changed: false`. Sent through
 * the race server's outbox, retried like results.
 */
export const setLobbyHostRequestSchema = z.object({
  v: versionSchema,
  lobbyId: idSchema,
  hostUserId: idSchema,
});
export type SetLobbyHostRequest = z.infer<typeof setLobbyHostRequestSchema>;

export const setLobbyHostResponseSchema = z.object({
  v: versionSchema,
  lobbyId: idSchema,
  /** True when this call wrote `hostUserId`; false when the row already named that host. */
  changed: z.boolean(),
});
export type SetLobbyHostResponse = z.infer<typeof setLobbyHostResponseSchema>;

export const internalErrorSchema = z.object({
  v: versionSchema,
  error: z.enum([
    "bad-signature",
    "stale-timestamp",
    "bad-body",
    "version",
    "not-found",
    "conflict",
    "replay",
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
  nonce: "5f2b9c0e8a4d4e1b9f3a7c6d2e1b0a98",
  body:
    '{"v":20,"lobbyId":"lob_test","code":"KGB-4821","hostUserId":"usr_test","settings":' +
    '{"language":"en","textType":"sentences","wordCount":50,"accentEveryWord":false,' +
    '"difficulty":{"level":"normal"},"practiceLetters":[],"includeNumbers":false,' +
    '"includeSymbols":false,"includePunctuation":true,"timerS":null,"errorMode":"continue",' +
    '"backspace":true,"bonuses":true,"bots":[],"lobbyType":"private","hostWatches":false}}',
  /** HMAC-SHA256 hex over `${timestamp}.${nonce}.${body}`. */
  signature: "fea90c3ed4254714e0de27a62f2abd751cfc92969765eaa54f8604a1bce76baf",
} as const;
