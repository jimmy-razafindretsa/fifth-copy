import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_RACE_SETTINGS,
  INTERNAL_HEADERS,
  INTERNAL_NONCE_HEX,
  openRoomRequestSchema,
  PROTOCOL_VERSION,
  roomStatusRequestSchema,
  roomTypeRequestSchema,
  sharedRoomRequestSchema,
  type OpenRoomRequest,
  type SharedRoomRequest,
  type RoomTypeRequest,
  type RoomStatusRequest,
  type RoomCode,
} from "@fifth-copy/protocol";
import { createInternalApiClient } from "./client";
import { signInternalBody } from "./sign";
import { startRaceServerStub, unreachableUrl, type RaceServerStub } from "./stub-server";

const secret = "r".repeat(32);
const request: OpenRoomRequest = {
  v: PROTOCOL_VERSION,
  lobbyId: "lob_1",
  code: "KGB-4821" as RoomCode,
  hostUserId: "usr_1",
  settings: DEFAULT_RACE_SETTINGS,
};
const opened = { v: PROTOCOL_VERSION, roomId: "lob_1", phase: "waiting", created: true };

describe("internal API client: openRoom", () => {
  let stub: RaceServerStub;

  beforeAll(async () => {
    stub = await startRaceServerStub();
  });
  beforeEach(() => {
    stub.requests.length = 0;
    stub.reply(() => ({ status: 200, body: opened }));
  });
  afterAll(() => stub.close());

  it("C3: POSTs /internal/rooms once with a schema-valid body and a valid signature over the raw body", async () => {
    const client = createInternalApiClient({ baseUrl: stub.url, secret, now: () => 1_767_225_600 });
    await expect(client.openRoom(request)).resolves.toEqual({ ok: true, data: opened });

    expect(stub.requests).toHaveLength(1);
    const [sent] = stub.requests;
    expect(sent).toMatchObject({ method: "POST", url: "/internal/rooms" });
    expect(openRoomRequestSchema.parse(JSON.parse(sent!.body))).toEqual(request);
    const timestamp = sent!.headers[INTERNAL_HEADERS.timestamp];
    expect(timestamp).toBe("1767225600");
    const nonce = sent!.headers[INTERNAL_HEADERS.nonce];
    expect(nonce).toMatch(INTERNAL_NONCE_HEX);
    expect(sent!.headers[INTERNAL_HEADERS.signature]).toBe(
      signInternalBody({
        timestamp: "1767225600",
        nonce: String(nonce),
        rawBody: sent!.body,
        secret,
      }),
    );
  });

  it("#518: two calls carry two different nonces", async () => {
    const client = createInternalApiClient({ baseUrl: stub.url, secret, now: () => 1_767_225_600 });
    await client.openRoom(request);
    await client.openRoom(request);
    const [a, b] = stub.requests.map((r) => r.headers[INTERNAL_HEADERS.nonce]);
    expect(a).toMatch(INTERNAL_NONCE_HEX);
    expect(b).toMatch(INTERNAL_NONCE_HEX);
    expect(a).not.toBe(b);
  });

  it.each([500, 401, 204])("a %i answer is race-server-unavailable", async (status) => {
    stub.reply(() => ({ status, body: { v: PROTOCOL_VERSION, error: "bad-signature" } }));
    const client = createInternalApiClient({ baseUrl: stub.url, secret });
    await expect(client.openRoom(request)).resolves.toEqual({
      ok: false,
      error: "race-server-unavailable",
    });
  });

  it("a 200 whose body is not an OpenRoomResponse is race-server-unavailable", async () => {
    stub.reply(() => ({ status: 200, body: { nope: true } }));
    const client = createInternalApiClient({ baseUrl: stub.url, secret });
    await expect(client.openRoom(request)).resolves.toMatchObject({ ok: false });
  });

  it("a refused connection is race-server-unavailable", async () => {
    const client = createInternalApiClient({ baseUrl: await unreachableUrl(), secret });
    await expect(client.openRoom(request)).resolves.toMatchObject({ ok: false });
  });

  it("a server that never answers is cut at the 2 s timeout", async () => {
    stub.reply(() => "hang");
    const client = createInternalApiClient({ baseUrl: stub.url, secret });
    const started = Date.now();
    await expect(client.openRoom(request)).resolves.toMatchObject({ ok: false });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(1_900);
    expect(elapsed).toBeLessThan(3_000);
  });
});

describe("internal API client: roomStatus (#806 C3)", () => {
  let stub: RaceServerStub;
  const lookup: RoomStatusRequest = { v: PROTOCOL_VERSION, lobbyIds: ["lob_1", "lob_2"] };
  const status = {
    v: PROTOCOL_VERSION,
    rooms: [{ lobbyId: "lob_1", phase: "waiting", typists: 2, bots: 1, seats: 30 }],
  };

  beforeAll(async () => {
    stub = await startRaceServerStub();
  });
  beforeEach(() => {
    stub.requests.length = 0;
    stub.reply(() => ({ status: 200, body: status }));
  });
  afterAll(() => stub.close());

  it("POSTs /internal/rooms/status once, signed over the raw body, and returns the parsed rooms", async () => {
    const client = createInternalApiClient({ baseUrl: stub.url, secret, now: () => 1_767_225_600 });
    await expect(client.roomStatus(lookup)).resolves.toEqual({ ok: true, data: status });
    expect(stub.requests).toHaveLength(1);
    const [sent] = stub.requests;
    expect(sent).toMatchObject({ method: "POST", url: "/internal/rooms/status" });
    expect(roomStatusRequestSchema.parse(JSON.parse(sent!.body))).toEqual(lookup);
    const nonce = String(sent!.headers[INTERNAL_HEADERS.nonce]);
    expect(nonce).toMatch(INTERNAL_NONCE_HEX);
    expect(sent!.headers[INTERNAL_HEADERS.signature]).toBe(
      signInternalBody({ timestamp: "1767225600", nonce, rawBody: sent!.body, secret }),
    );
  });

  it.each([500, 503, 401, 204])("a %i answer is race-server-unavailable", async (code) => {
    stub.reply(() => ({ status: code, body: { v: PROTOCOL_VERSION, error: "bad-signature" } }));
    const client = createInternalApiClient({ baseUrl: stub.url, secret });
    await expect(client.roomStatus(lookup)).resolves.toEqual({
      ok: false,
      error: "race-server-unavailable",
    });
  });

  it("a 200 whose body is not a RoomStatusResponse is race-server-unavailable", async () => {
    stub.reply(() => ({ status: 200, body: { v: PROTOCOL_VERSION, rooms: [{ lobbyId: "x" }] } }));
    const client = createInternalApiClient({ baseUrl: stub.url, secret });
    await expect(client.roomStatus(lookup)).resolves.toMatchObject({ ok: false });
  });

  it("a refused connection is race-server-unavailable", async () => {
    const client = createInternalApiClient({ baseUrl: await unreachableUrl(), secret });
    await expect(client.roomStatus(lookup)).resolves.toMatchObject({ ok: false });
  });

  it("a server that never answers is cut at the same timeout as openRoom", async () => {
    stub.reply(() => "hang");
    const client = createInternalApiClient({ baseUrl: stub.url, secret, timeoutMs: 300 });
    const started = Date.now();
    await expect(client.roomStatus(lookup)).resolves.toMatchObject({ ok: false });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(250);
    expect(elapsed).toBeLessThan(1_500);
  });
});

describe("internal API client: setRoomType (#815 C4)", () => {
  let stub: RaceServerStub;
  const typed: RoomTypeRequest = { v: PROTOCOL_VERSION, lobbyId: "lob_1", lobbyType: "public" };
  const filed = { v: PROTOCOL_VERSION, result: "ok" };

  beforeAll(async () => {
    stub = await startRaceServerStub();
  });
  beforeEach(() => {
    stub.requests.length = 0;
    stub.reply(() => ({ status: 200, body: filed }));
  });
  afterAll(() => stub.close());

  it("POSTs /internal/rooms/type once, signed over the raw body, and returns the parsed result", async () => {
    const client = createInternalApiClient({ baseUrl: stub.url, secret, now: () => 1_767_225_600 });
    await expect(client.setRoomType(typed)).resolves.toEqual({ ok: true, data: filed });
    expect(stub.requests).toHaveLength(1);
    const [sent] = stub.requests;
    expect(sent).toMatchObject({ method: "POST", url: "/internal/rooms/type" });
    expect(roomTypeRequestSchema.parse(JSON.parse(sent!.body))).toEqual(typed);
    const nonce = String(sent!.headers[INTERNAL_HEADERS.nonce]);
    expect(nonce).toMatch(INTERNAL_NONCE_HEX);
    expect(sent!.headers[INTERNAL_HEADERS.signature]).toBe(
      signInternalBody({ timestamp: "1767225600", nonce, rawBody: sent!.body, secret }),
    );
  });

  it.each(["no-room", "not-waiting"] as const)("a %s result is a parsed answer", async (result) => {
    stub.reply(() => ({ status: 200, body: { v: PROTOCOL_VERSION, result } }));
    const client = createInternalApiClient({ baseUrl: stub.url, secret });
    await expect(client.setRoomType(typed)).resolves.toEqual({
      ok: true,
      data: { v: PROTOCOL_VERSION, result },
    });
  });

  it.each([500, 503, 401, 426])("a %i answer is race-server-unavailable", async (code) => {
    stub.reply(() => ({ status: code, body: { v: PROTOCOL_VERSION, error: "bad-signature" } }));
    const client = createInternalApiClient({ baseUrl: stub.url, secret });
    await expect(client.setRoomType(typed)).resolves.toEqual({
      ok: false,
      error: "race-server-unavailable",
    });
  });

  it("a 200 whose body is not a RoomTypeResponse is race-server-unavailable", async () => {
    stub.reply(() => ({ status: 200, body: { v: PROTOCOL_VERSION, result: "maybe" } }));
    const client = createInternalApiClient({ baseUrl: stub.url, secret });
    await expect(client.setRoomType(typed)).resolves.toEqual({
      ok: false,
      error: "race-server-unavailable",
    });
  });

  it("a refused connection is race-server-unavailable", async () => {
    const client = createInternalApiClient({ baseUrl: await unreachableUrl(), secret });
    await expect(client.setRoomType(typed)).resolves.toMatchObject({ ok: false });
  });

  it("a server that never answers is cut at the same timeout as openRoom", async () => {
    stub.reply(() => "hang");
    const client = createInternalApiClient({ baseUrl: stub.url, secret, timeoutMs: 300 });
    const started = Date.now();
    await expect(client.setRoomType(typed)).resolves.toMatchObject({ ok: false });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(250);
    expect(elapsed).toBeLessThan(1_500);
  });
});

describe("internal API client: sharedRoom (#65 C5)", () => {
  let stub: RaceServerStub;
  const pair: SharedRoomRequest = { v: PROTOCOL_VERSION, userIds: ["usr_a", "usr_b"] };
  const shared = { v: PROTOCOL_VERSION, shared: true };

  beforeAll(async () => {
    stub = await startRaceServerStub();
  });
  beforeEach(() => {
    stub.requests.length = 0;
    stub.reply(() => ({ status: 200, body: shared }));
  });
  afterAll(() => stub.close());

  it("POSTs /internal/rooms/shared once, signed over the raw body, and returns the parsed answer", async () => {
    const client = createInternalApiClient({ baseUrl: stub.url, secret, now: () => 1_767_225_600 });
    await expect(client.sharedRoom(pair)).resolves.toEqual({ ok: true, data: shared });
    expect(stub.requests).toHaveLength(1);
    const [sent] = stub.requests;
    expect(sent).toMatchObject({ method: "POST", url: "/internal/rooms/shared" });
    expect(sharedRoomRequestSchema.parse(JSON.parse(sent!.body))).toEqual(pair);
    const nonce = String(sent!.headers[INTERNAL_HEADERS.nonce]);
    expect(nonce).toMatch(INTERNAL_NONCE_HEX);
    expect(sent!.headers[INTERNAL_HEADERS.signature]).toBe(
      signInternalBody({ timestamp: "1767225600", nonce, rawBody: sent!.body, secret }),
    );
  });

  it("a shared: false answer is a parsed answer", async () => {
    stub.reply(() => ({ status: 200, body: { v: PROTOCOL_VERSION, shared: false } }));
    const client = createInternalApiClient({ baseUrl: stub.url, secret });
    await expect(client.sharedRoom(pair)).resolves.toEqual({
      ok: true,
      data: { v: PROTOCOL_VERSION, shared: false },
    });
  });

  it.each([500, 503, 401, 426, 400])(
    "a %i answer is race-server-unavailable, never shared",
    async (code) => {
      stub.reply(() => ({ status: code, body: { v: PROTOCOL_VERSION, shared: true } }));
      const client = createInternalApiClient({ baseUrl: stub.url, secret });
      await expect(client.sharedRoom(pair)).resolves.toEqual({
        ok: false,
        error: "race-server-unavailable",
      });
    },
  );

  it.each([
    ["shared not a boolean", { v: PROTOCOL_VERSION, shared: "true" }],
    ["shared missing", { v: PROTOCOL_VERSION }],
    ["another version", { v: PROTOCOL_VERSION + 1, shared: true }],
    ["extra fields", { v: PROTOCOL_VERSION, shared: true, lobbyId: "lob_1" }],
    ["a bare string", "shared"],
  ])("a 200 with %s is race-server-unavailable, never shared", async (_, body) => {
    stub.reply(() => ({ status: 200, body }));
    const client = createInternalApiClient({ baseUrl: stub.url, secret });
    await expect(client.sharedRoom(pair)).resolves.toEqual({
      ok: false,
      error: "race-server-unavailable",
    });
  });

  it("a refused connection is race-server-unavailable", async () => {
    const client = createInternalApiClient({ baseUrl: await unreachableUrl(), secret });
    await expect(client.sharedRoom(pair)).resolves.toEqual({
      ok: false,
      error: "race-server-unavailable",
    });
  });

  it("a server that never answers is cut at the same timeout as openRoom", async () => {
    stub.reply(() => "hang");
    const client = createInternalApiClient({ baseUrl: stub.url, secret, timeoutMs: 300 });
    const started = Date.now();
    await expect(client.sharedRoom(pair)).resolves.toEqual({
      ok: false,
      error: "race-server-unavailable",
    });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(250);
    expect(elapsed).toBeLessThan(1_500);
  });
});
