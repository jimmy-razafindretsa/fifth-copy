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
  ] as const)("%s", (_, schema, payload, ok) => {
    expect(schema.safeParse(payload).success).toBe(ok);
  });
});
