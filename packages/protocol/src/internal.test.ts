import { describe, expect, it } from "vitest";
import {
  DEFAULT_RACE_SETTINGS,
  INTERNAL_HEADERS,
  INTERNAL_HMAC_TEST_VECTOR,
  INTERNAL_MAX_SKEW_S,
  INTERNAL_NONCE_HEX,
  INTERNAL_NONCE_TTL_S,
  internalErrorSchema,
  internalSignedString,
  openRoomRequestSchema,
  openRoomResponseSchema,
  PROTOCOL_VERSION,
  raceResultsRequestSchema,
  raceResultsResponseSchema,
  startRaceRequestSchema,
  startRaceResponseSchema,
  internalRaceResultSchema,
  MAX_OVERLAY_WORDS,
  MAX_RESULTS_PER_REQUEST,
  MAX_ROOM_STATUS_IDS,
  roomStatusRequestSchema,
  roomStatusResponseSchema,
  roomTypeRequestSchema,
  roomTypeResponseSchema,
  closeLobbyRequestSchema,
  closeLobbyResponseSchema,
  raceResultsRequestSchema as resultsSchema,
} from "./index";

const v = PROTOCOL_VERSION;
const request = {
  v,
  lobbyId: "lob_1",
  code: "KGB-4821",
  hostUserId: "usr_1",
  settings: DEFAULT_RACE_SETTINGS,
};
const response = { v, roomId: "room_1", phase: "waiting", created: true };
const raceId = "3f0c8a52-6a3e-4c1b-9d7e-2b5f1e8a4c90";
const start = {
  v,
  raceId,
  lobbyId: "lob_1",
  hostUserId: "usr_1",
  settings: DEFAULT_RACE_SETTINGS,
  desks: [
    { desk: 1, userId: "usr_1", name: "Ada", isBot: false },
    { desk: 2, userId: null, name: "Clerk 2", isBot: true },
  ],
};
const started = {
  v,
  raceId,
  text: { content: "Workers of the world, type.", language: "en", wordCount: 5, sourceRef: null },
  settings: DEFAULT_RACE_SETTINGS,
  startedAt: 1767225600000,
};
const result = {
  desk: 1,
  userId: "usr_1",
  name: "Ada",
  isBot: false,
  place: 1,
  status: "finished",
  wpm: 62.5,
  rawWpm: 70,
  cleanWpm: 62.5,
  adjustedWpm: 60,
  accuracy: 0.97,
  progress: 1,
  correct: 120,
  errors: 4,
  total: 130,
  durationMs: 41000,
  finishedAtMs: 41000,
  bonusesSent: 1,
  bonusesReceived: 0,
  bonusLog: [{ t: 12000, kind: "exemption", from: 1, to: 2 }],
  overlay: null,
  flags: [{ code: "timing-anomaly", detail: "3 clamped" }, { code: "burst" }],
  engineVersion: "0.3.0",
  trace: { encoding: "gzip+base64", data: "H4sIAAAAAAAAA4uOBQApu0wNAgAAAA==", count: 2 },
};
const results = {
  v,
  raceId,
  endedAt: 1767225641000,
  reason: "all-finished",
  lobbySize: 2,
  results: [result],
};

describe("internal API", () => {
  it("fixes the header names and the skew window", () => {
    expect(INTERNAL_HEADERS).toEqual({
      timestamp: "x-fc-timestamp",
      signature: "x-fc-signature",
      nonce: "x-fc-nonce",
    });
    expect(INTERNAL_MAX_SKEW_S).toBe(300);
  });

  it("C1: protocol 7+ signs `${timestamp}.${nonce}.${rawBody}`", () => {
    expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(7);
    expect(internalSignedString({ timestamp: "1", nonce: "ab", rawBody: '{"v":8}' })).toBe(
      '1.ab.{"v":8}',
    );
  });

  it("C2: a nonce is remembered across the whole +-skew acceptance span", () => {
    expect(INTERNAL_NONCE_TTL_S).toBe(2 * INTERNAL_MAX_SKEW_S);
    expect(INTERNAL_NONCE_TTL_S).toBeGreaterThanOrEqual(INTERNAL_MAX_SKEW_S);
  });

  it.each([
    ["the vector nonce", INTERNAL_HMAC_TEST_VECTOR.nonce, true],
    ["32 lowercase hex", "0".repeat(32), true],
    ["uppercase hex", "A".repeat(32), false],
    ["31 chars", "a".repeat(31), false],
    ["33 chars", "a".repeat(33), false],
    ["non-hex", "g".repeat(32), false],
    ["empty", "", false],
    ["a trailing newline", `${"a".repeat(32)}\n`, false],
  ])("nonce format: %s -> %s", (_, nonce, ok) => {
    expect(INTERNAL_NONCE_HEX.test(nonce)).toBe(ok);
  });

  it("test vector body is a valid open-room request", () => {
    expect(
      openRoomRequestSchema.safeParse(JSON.parse(INTERNAL_HMAC_TEST_VECTOR.body)).success,
    ).toBe(true);
    expect(INTERNAL_HMAC_TEST_VECTOR.signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it("test vector body carries the current version first and the default settings", () => {
    expect(INTERNAL_HMAC_TEST_VECTOR.body.startsWith(`{"v":${PROTOCOL_VERSION},`)).toBe(true);
    expect(JSON.parse(INTERNAL_HMAC_TEST_VECTOR.body).settings).toEqual(DEFAULT_RACE_SETTINGS);
  });

  it("caps a results request at 25 results", () => {
    expect(MAX_RESULTS_PER_REQUEST).toBe(25);
  });

  it.each([
    ["open request example", openRoomRequestSchema, request, true],
    ["open request v: 1", openRoomRequestSchema, { ...request, v: 1 }, false],
    ["open request previous v", openRoomRequestSchema, { ...request, v: v - 1 }, false],
    [
      "open request missing settings",
      openRoomRequestSchema,
      { ...request, settings: undefined },
      false,
    ],
    [
      "open request invalid settings",
      openRoomRequestSchema,
      { ...request, settings: { ...DEFAULT_RACE_SETTINGS, timerS: 59 } },
      false,
    ],
    [
      "open request missing host",
      openRoomRequestSchema,
      { ...request, hostUserId: undefined },
      false,
    ],
    [
      "open request oversize lobbyId",
      openRoomRequestSchema,
      { ...request, lobbyId: "l".repeat(129) },
      false,
    ],
    [
      "open request oversize host",
      openRoomRequestSchema,
      { ...request, hostUserId: "u".repeat(129) },
      false,
    ],
    ["open request bad code", openRoomRequestSchema, { ...request, code: "KGB4821" }, false],
    ["open response example", openRoomResponseSchema, response, true],
    ["open response v: 1", openRoomResponseSchema, { ...response, v: 1 }, false],
    [
      "open response missing created",
      openRoomResponseSchema,
      { ...response, created: undefined },
      false,
    ],
    ["open response wrong phase", openRoomResponseSchema, { ...response, phase: "racing" }, false],
    ["error example", internalErrorSchema, { v, error: "bad-signature" }, true],
    ["error v: 1", internalErrorSchema, { v: 1, error: "bad-signature" }, false],
    ["error missing error", internalErrorSchema, { v }, false],
    ["error wrong enum", internalErrorSchema, { v, error: "teapot" }, false],
    ["error not-found", internalErrorSchema, { v, error: "not-found" }, true],
    ["error conflict", internalErrorSchema, { v, error: "conflict" }, true],
    ["error replay", internalErrorSchema, { v, error: "replay" }, true],
    ["start example", startRaceRequestSchema, start, true],
    ["start previous v", startRaceRequestSchema, { ...start, v: v - 1 }, false],
    ["start missing desks", startRaceRequestSchema, { ...start, desks: undefined }, false],
    ["start no desks", startRaceRequestSchema, { ...start, desks: [] }, false],
    ["start raceId not uuid v4", startRaceRequestSchema, { ...start, raceId: "race_1" }, false],
    [
      "start invalid settings",
      startRaceRequestSchema,
      { ...start, settings: { ...DEFAULT_RACE_SETTINGS, errorMode: "strict" } },
      false,
    ],
    ["started example", startRaceResponseSchema, started, true],
    ["started previous v", startRaceResponseSchema, { ...started, v: v - 1 }, false],
    [
      "started missing startedAt",
      startRaceResponseSchema,
      { ...started, startedAt: undefined },
      false,
    ],
    [
      "started wrong language",
      startRaceResponseSchema,
      { ...started, text: { ...started.text, language: "ru" } },
      false,
    ],
    ["result example", internalRaceResultSchema, result, true],
    [
      "result bot timed out",
      internalRaceResultSchema,
      { ...result, userId: null, isBot: true, status: "typing", finishedAtMs: null },
      true,
    ],
    // The desk's final text overlay (#623 C1): null when untouched, verbatim when overlaid.
    [
      "result overlay verbatim",
      internalRaceResultSchema,
      { ...result, overlay: { extra: ["quota", "ration"], removed: [0, 3] } },
      true,
    ],
    [
      "result overlay empty object",
      internalRaceResultSchema,
      { ...result, overlay: { extra: [], removed: [] } },
      true,
    ],
    ["result overlay missing", internalRaceResultSchema, { ...result, overlay: undefined }, false],
    [
      "result overlay extra above MAX_OVERLAY_WORDS",
      internalRaceResultSchema,
      {
        ...result,
        overlay: { extra: Array.from({ length: MAX_OVERLAY_WORDS + 1 }, () => "w"), removed: [] },
      },
      false,
    ],
    [
      "result overlay removed above MAX_OVERLAY_WORDS",
      internalRaceResultSchema,
      {
        ...result,
        overlay: { extra: [], removed: Array.from({ length: MAX_OVERLAY_WORDS + 1 }, (_, i) => i) },
      },
      false,
    ],
    [
      "result overlay negative index",
      internalRaceResultSchema,
      { ...result, overlay: { extra: [], removed: [-1] } },
      false,
    ],
    ["result missing trace", internalRaceResultSchema, { ...result, trace: undefined }, false],
    ["result wrong status", internalRaceResultSchema, { ...result, status: "timed-out" }, false],
    [
      "result wrong encoding",
      internalRaceResultSchema,
      { ...result, trace: { ...result.trace, encoding: "raw" } },
      false,
    ],
    [
      "result trace not base64",
      internalRaceResultSchema,
      { ...result, trace: { ...result.trace, data: "not base64!" } },
      false,
    ],
    [
      "result wrong bonus",
      internalRaceResultSchema,
      { ...result, bonusLog: [{ t: 1, kind: "vodka", from: 1, to: 2 }] },
      false,
    ],
    ["results example", raceResultsRequestSchema, results, true],
    ["results previous v", raceResultsRequestSchema, { ...results, v: v - 1 }, false],
    ["results void", raceResultsRequestSchema, { ...results, reason: "void" }, false],
    [
      "results missing endedAt",
      raceResultsRequestSchema,
      { ...results, endedAt: undefined },
      false,
    ],
    ["results none", raceResultsRequestSchema, { ...results, results: [] }, false],
    [
      "results 26",
      raceResultsRequestSchema,
      { ...results, results: Array.from({ length: 26 }, () => result) },
      false,
    ],
    ["persisted example", raceResultsResponseSchema, { v, raceId, persisted: [1] }, true],
    [
      "persisted previous v",
      raceResultsResponseSchema,
      { v: v - 1, raceId, persisted: [1] },
      false,
    ],
    ["persisted missing raceId", raceResultsResponseSchema, { v, persisted: [1] }, false],
  ] as const)("%s", (_, schema, payload, ok) => {
    expect(schema.safeParse(payload).success).toBe(ok);
  });
});

describe("room status lookup (#806 C1)", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `lob_${i}`);
  const room = { lobbyId: "lob_1", phase: "waiting", typists: 2, bots: 1, seats: 30 };

  it("caps a lookup at 50 lobby ids", () => {
    expect(MAX_ROOM_STATUS_IDS).toBe(50);
  });

  it.each([
    ["request example", roomStatusRequestSchema, { v, lobbyIds: ["lob_1"] }, true],
    ["request 50 ids", roomStatusRequestSchema, { v, lobbyIds: ids(50) }, true],
    ["request 51 ids", roomStatusRequestSchema, { v, lobbyIds: ids(51) }, false],
    ["request no id", roomStatusRequestSchema, { v, lobbyIds: [] }, false],
    ["request empty id", roomStatusRequestSchema, { v, lobbyIds: [""] }, false],
    ["request oversize id", roomStatusRequestSchema, { v, lobbyIds: ["l".repeat(129)] }, false],
    ["request missing ids", roomStatusRequestSchema, { v }, false],
    ["request previous v", roomStatusRequestSchema, { v: v - 1, lobbyIds: ["lob_1"] }, false],
    ["response example", roomStatusResponseSchema, { v, rooms: [room] }, true],
    ["response no room found", roomStatusResponseSchema, { v, rooms: [] }, true],
    ["response previous v", roomStatusResponseSchema, { v: v - 1, rooms: [room] }, false],
    [
      "response every phase",
      roomStatusResponseSchema,
      {
        v,
        rooms: (["waiting", "countdown", "running", "ended"] as const).map((phase) => ({
          ...room,
          phase,
        })),
      },
      true,
    ],
    [
      "response unknown phase",
      roomStatusResponseSchema,
      { v, rooms: [{ ...room, phase: "racing" }] },
      false,
    ],
    [
      "response negative typists",
      roomStatusResponseSchema,
      { v, rooms: [{ ...room, typists: -1 }] },
      false,
    ],
    [
      "response fractional bots",
      roomStatusResponseSchema,
      { v, rooms: [{ ...room, bots: 1.5 }] },
      false,
    ],
    ["response no seats", roomStatusResponseSchema, { v, rooms: [{ ...room, seats: 0 }] }, false],
    [
      "response missing lobbyId",
      roomStatusResponseSchema,
      { v, rooms: [{ ...room, lobbyId: undefined }] },
      false,
    ],
    [
      "response 51 rooms",
      roomStatusResponseSchema,
      { v, rooms: ids(51).map((lobbyId) => ({ ...room, lobbyId })) },
      false,
    ],
  ] as const)("%s", (_, schema, payload, ok) => {
    expect(schema.safeParse(payload).success).toBe(ok);
  });

  it("a room entry carries only lobbyId, phase and the desk counts (no names, users or settings)", () => {
    const parsed = roomStatusResponseSchema.parse({
      v,
      rooms: [{ ...room, hostUserId: "usr_1", names: ["Ada"], settings: {} }],
    });
    expect(Object.keys(parsed.rooms[0]!).sort()).toEqual(
      ["bots", "lobbyId", "phase", "seats", "typists"].sort(),
    );
  });
});

describe("lobby close (#734 C6)", () => {
  const close = { v, lobbyId: "lob_1", closedAt: 1_767_225_600_000 };

  it.each([
    ["request example", closeLobbyRequestSchema, close, true],
    ["request closedAt 0", closeLobbyRequestSchema, { ...close, closedAt: 0 }, true],
    ["request negative closedAt", closeLobbyRequestSchema, { ...close, closedAt: -1 }, false],
    ["request fractional closedAt", closeLobbyRequestSchema, { ...close, closedAt: 1.5 }, false],
    ["request empty lobbyId", closeLobbyRequestSchema, { ...close, lobbyId: "" }, false],
    [
      "request oversize lobbyId",
      closeLobbyRequestSchema,
      { ...close, lobbyId: "l".repeat(129) },
      false,
    ],
    ["request missing closedAt", closeLobbyRequestSchema, { v, lobbyId: "lob_1" }, false],
    ["request previous v", closeLobbyRequestSchema, { ...close, v: v - 1 }, false],
    ["response closed now", closeLobbyResponseSchema, { v, lobbyId: "lob_1", changed: true }, true],
    [
      "response already closed",
      closeLobbyResponseSchema,
      { v, lobbyId: "lob_1", changed: false },
      true,
    ],
    ["response missing changed", closeLobbyResponseSchema, { v, lobbyId: "lob_1" }, false],
    [
      "response previous v",
      closeLobbyResponseSchema,
      { v: v - 1, lobbyId: "lob_1", changed: true },
      false,
    ],
  ] as const)("%s", (_, schema, payload, ok) => {
    expect(schema.safeParse(payload).success).toBe(ok);
  });

  it("a close request never parses as a results request (the race server's outbox tells them apart)", () => {
    expect(resultsSchema.safeParse(close).success).toBe(false);
  });
});

describe("room type (#815 C1)", () => {
  const typed = { v, lobbyId: "lob_1", lobbyType: "public" };

  it.each([
    ["request public", roomTypeRequestSchema, typed, true],
    ["request private", roomTypeRequestSchema, { ...typed, lobbyType: "private" }, true],
    ["request unknown type", roomTypeRequestSchema, { ...typed, lobbyType: "secret" }, false],
    ["request missing type", roomTypeRequestSchema, { v, lobbyId: "lob_1" }, false],
    ["request empty lobbyId", roomTypeRequestSchema, { ...typed, lobbyId: "" }, false],
    [
      "request oversize lobbyId",
      roomTypeRequestSchema,
      { ...typed, lobbyId: "l".repeat(129) },
      false,
    ],
    ["request previous v", roomTypeRequestSchema, { ...typed, v: v - 1 }, false],
    ["response ok", roomTypeResponseSchema, { v, result: "ok" }, true],
    ["response no-room", roomTypeResponseSchema, { v, result: "no-room" }, true],
    ["response not-waiting", roomTypeResponseSchema, { v, result: "not-waiting" }, true],
    ["response unknown result", roomTypeResponseSchema, { v, result: "not-host" }, false],
    ["response missing result", roomTypeResponseSchema, { v }, false],
    ["response previous v", roomTypeResponseSchema, { v: v - 1, result: "ok" }, false],
  ] as const)("%s", (_, schema, payload, ok) => {
    expect(schema.safeParse(payload).success).toBe(ok);
  });

  it("takes its type from the race settings' own enum", () => {
    expect(roomTypeRequestSchema.shape.lobbyType.options).toEqual(["public", "private"]);
  });
});
