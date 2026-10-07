import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RACE_SETTINGS,
  INTERNAL_HEADERS,
  PROTOCOL_VERSION,
  type StartRaceRequest,
  type StartRaceResponse,
} from "@fifth-copy/protocol";
import { createFakeClock, createFakeScheduler } from "../clock";
import { verifyInternalRequest } from "../http/hmac";
import { createWebApi, WEB_API_TIMEOUT_MS } from "./web-api";

const SECRET = "web-api-test-secret-0123456789abcdef";
const RACE_ID = "6f1c2a4e-8b9d-4c3e-9f0a-1b2c3d4e5f60";

const request: StartRaceRequest = {
  v: PROTOCOL_VERSION,
  raceId: RACE_ID,
  lobbyId: "lob_1",
  hostUserId: "usr_host",
  settings: DEFAULT_RACE_SETTINGS,
  desks: [
    { desk: 1, userId: "usr_host", name: "Ada", isBot: false },
    { desk: 2, userId: null, name: "Bot-1", isBot: true },
  ],
};
const answer: StartRaceResponse = {
  v: PROTOCOL_VERSION,
  raceId: RACE_ID,
  text: { content: "Call me Ishmael.", language: "en", wordCount: 3, sourceRef: "seed:en:v1" },
  settings: DEFAULT_RACE_SETTINGS,
  startedAt: 1_767_225_600_000,
};

function setup(fetchImpl: typeof fetch) {
  const clock = createFakeClock(1_767_225_600_000);
  const scheduler = createFakeScheduler(clock);
  const api = createWebApi({
    baseUrl: "http://web.test:5199",
    secret: SECRET,
    clock,
    scheduler,
    fetchImpl,
  });
  return { api, clock, scheduler };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.restoreAllMocks());

describe("createWebApi.startRace (C4)", () => {
  it("POSTs the signed body to /api/internal/races and returns the parsed answer", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => json(200, answer));
    const { api, clock, scheduler } = setup(fetchImpl as unknown as typeof fetch);

    expect(await api.startRace(request)).toEqual(answer);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("http://web.test:5199/api/internal/races");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(JSON.parse(init.body as string)).toEqual(request);
    expect(headers[INTERNAL_HEADERS.timestamp]).toBe(String(clock.now() / 1000));
    expect(
      verifyInternalRequest({
        secret: SECRET,
        timestamp: headers[INTERNAL_HEADERS.timestamp],
        signature: headers[INTERNAL_HEADERS.signature],
        rawBody: init.body as string,
        nowMs: clock.now(),
      }),
    ).toEqual({ ok: true });
    expect(scheduler.armed()).toBe(0);
  });

  it("rejects on a 5xx, a 4xx, a thrown fetch and a 200 with an invalid body", async () => {
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    const replies: (() => Promise<Response>)[] = [
      async () => json(500, { error: "boom" }),
      async () => json(409, { v: PROTOCOL_VERSION, error: "conflict" }),
      async () => {
        throw new TypeError("fetch failed");
      },
      async () => json(200, { ...answer, text: { ...answer.text, content: "" } }),
      async () => new Response("<html>not json</html>", { status: 200 }),
    ];
    for (const reply of replies) {
      const { api, scheduler } = setup(reply as unknown as typeof fetch);
      await expect(api.startRace(request)).rejects.toThrow();
      expect(scheduler.armed()).toBe(0);
    }
    // Outcome lines only: never the body or the signature.
    for (const [line] of logs.mock.calls) {
      expect(String(line)).not.toContain("boom");
      expect(String(line)).not.toContain(INTERNAL_HEADERS.signature);
    }
  });

  it("rejects a fetch that never resolves once 5 s pass on the server clock, and aborts it", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    let signal: AbortSignal | undefined;
    const fetchImpl = (_url: URL, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return new Promise<Response>(() => {});
    };
    const { api, clock } = setup(fetchImpl as unknown as typeof fetch);
    let settled = false;
    const call = api.startRace(request).finally(() => (settled = true));
    call.catch(() => {});

    clock.advance(WEB_API_TIMEOUT_MS - 1);
    await Promise.resolve();
    expect(settled).toBe(false);
    clock.advance(1);
    await expect(call).rejects.toThrow(/timeout/);
    expect(signal?.aborted).toBe(true);
  });
});
