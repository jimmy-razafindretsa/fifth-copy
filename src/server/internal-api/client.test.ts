import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_RACE_SETTINGS,
  INTERNAL_HEADERS,
  openRoomRequestSchema,
  PROTOCOL_VERSION,
  type OpenRoomRequest,
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
    expect(sent!.headers[INTERNAL_HEADERS.signature]).toBe(
      signInternalBody({ timestamp: "1767225600", rawBody: sent!.body, secret }),
    );
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
