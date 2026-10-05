import { describe, expect, it } from "vitest";
import {
  INTERNAL_HEADERS,
  INTERNAL_HMAC_TEST_VECTOR,
  INTERNAL_MAX_SKEW_S,
  internalErrorSchema,
  openRoomRequestSchema,
  openRoomResponseSchema,
} from "./index";

const request = { v: 2, lobbyId: "lob_1", code: "KGB-4821", hostUserId: "usr_1" };
const response = { v: 2, roomId: "room_1", phase: "waiting", created: true };

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

  it.each([
    ["open request example", openRoomRequestSchema, request, true],
    ["open request v: 1", openRoomRequestSchema, { ...request, v: 1 }, false],
    ["open request missing host", openRoomRequestSchema, { ...request, hostUserId: undefined }, false],
    ["open request bad code", openRoomRequestSchema, { ...request, code: "KGB4821" }, false],
    ["open response example", openRoomResponseSchema, response, true],
    ["open response v: 1", openRoomResponseSchema, { ...response, v: 1 }, false],
    ["open response missing created", openRoomResponseSchema, { ...response, created: undefined }, false],
    ["open response wrong phase", openRoomResponseSchema, { ...response, phase: "racing" }, false],
    ["error example", internalErrorSchema, { v: 2, error: "bad-signature" }, true],
    ["error v: 1", internalErrorSchema, { v: 1, error: "bad-signature" }, false],
    ["error missing error", internalErrorSchema, { v: 2 }, false],
    ["error wrong enum", internalErrorSchema, { v: 2, error: "teapot" }, false],
  ] as const)("%s", (_, schema, payload, ok) => {
    expect(schema.safeParse(payload).success).toBe(ok);
  });
});
