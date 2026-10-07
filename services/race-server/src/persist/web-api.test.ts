import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RACE_SETTINGS,
  INTERNAL_HEADERS,
  PROTOCOL_VERSION,
  type RaceResultsRequest,
  type StartRaceRequest,
  type StartRaceResponse,
} from "@fifth-copy/protocol";
import { createFakeClock, createFakeScheduler } from "../clock";
import { verifyInternalRequest } from "../http/hmac";
import { createWebApi, MAX_WEB_RESPONSE_BYTES, WEB_API_TIMEOUT_MS } from "./web-api";

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

  it("asks fetch not to follow redirects and rejects a 3xx", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: "http://elsewhere.test/" } }),
    );
    const { api } = setup(fetchImpl as unknown as typeof fetch);
    await expect(api.startRace(request)).rejects.toThrow();
    const [, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(init.redirect).toBe("manual");
  });

  it("over real HTTP, a redirect is not followed: the target is never called", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const hits: string[] = [];
    const server = createServer((req, res) => {
      hits.push(req.url ?? "");
      if (req.url === "/api/internal/races") {
        res.writeHead(307, { location: "/elsewhere" });
        return res.end();
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(answer));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const clock = createFakeClock(1_767_225_600_000);
      const api = createWebApi({
        baseUrl: `http://127.0.0.1:${port}`,
        secret: SECRET,
        clock,
        scheduler: createFakeScheduler(clock),
      });
      await expect(api.startRace(request)).rejects.toThrow();
      expect(hits).toEqual(["/api/internal/races"]);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("rejects a response larger than the cap without reading all of it", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const chunk = new Uint8Array(16 * 1024).fill(0x20);
    let produced = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        produced += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const { api, scheduler } = setup(
      (async () => new Response(endless, { status: 200 })) as unknown as typeof fetch,
    );
    await expect(api.startRace(request)).rejects.toThrow(/too large/);
    expect(produced).toBeLessThanOrEqual(MAX_WEB_RESPONSE_BYTES + 4 * chunk.byteLength);
    expect(scheduler.armed()).toBe(0);

    const declared = vi.fn(
      async () =>
        new Response("{}", {
          status: 200,
          headers: { "content-length": String(MAX_WEB_RESPONSE_BYTES + 1) },
        }),
    );
    await expect(setup(declared as unknown as typeof fetch).api.startRace(request)).rejects.toThrow(
      /too large/,
    );
  });
});

describe("createWebApi.postResults (#189)", () => {
  const results: RaceResultsRequest = {
    v: PROTOCOL_VERSION,
    raceId: RACE_ID,
    endedAt: 1_767_225_660_000,
    reason: "timer",
    lobbySize: 1,
    results: [
      {
        desk: 1,
        userId: "usr_host",
        name: "Ada",
        isBot: false,
        place: 1,
        status: "typing",
        wpm: 0,
        rawWpm: 0,
        cleanWpm: 0,
        adjustedWpm: 0,
        accuracy: 1,
        progress: 0,
        correct: 0,
        errors: 0,
        total: 0,
        durationMs: 60_000,
        finishedAtMs: null,
        bonusesSent: 0,
        bonusesReceived: 0,
        bonusLog: [],
        flags: [],
        engineVersion: "1",
        trace: { encoding: "gzip+base64", data: "", count: 0 },
      },
    ],
  };

  it("POSTs the signed chunk to /api/internal/races/:id/results and parses the ack", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const ack = { v: PROTOCOL_VERSION, raceId: RACE_ID, persisted: [1] };
    const fetchImpl = vi.fn(async () => json(200, ack));
    const { api, clock, scheduler } = setup(fetchImpl as unknown as typeof fetch);

    expect(await api.postResults(results)).toEqual(ack);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe(`http://web.test:5199/api/internal/races/${RACE_ID}/results`);
    const headers = init.headers as Record<string, string>;
    expect(JSON.parse(init.body as string)).toEqual(results);
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

    const bad = setup((async () => json(200, { v: PROTOCOL_VERSION })) as unknown as typeof fetch);
    await expect(bad.api.postResults(results)).rejects.toThrow();
    const refused = setup((async () =>
      json(400, { error: "bad-body" })) as unknown as typeof fetch);
    await expect(refused.api.postResults(results)).rejects.toThrow(/status 400/);
  });
});
