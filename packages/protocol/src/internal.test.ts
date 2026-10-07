import { describe, expect, it } from "vitest";
import {
  DEFAULT_RACE_SETTINGS,
  INTERNAL_HEADERS,
  INTERNAL_HMAC_TEST_VECTOR,
  INTERNAL_MAX_SKEW_S,
  internalErrorSchema,
  openRoomRequestSchema,
  openRoomResponseSchema,
  PROTOCOL_VERSION,
  raceResultsRequestSchema,
  raceResultsResponseSchema,
  startRaceRequestSchema,
  startRaceResponseSchema,
  internalRaceResultSchema,
  MAX_RESULTS_PER_REQUEST,
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
    expect(INTERNAL_HEADERS).toEqual({ timestamp: "x-fc-timestamp", signature: "x-fc-signature" });
    expect(INTERNAL_MAX_SKEW_S).toBe(300);
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
