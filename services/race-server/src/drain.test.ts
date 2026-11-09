import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RACE_SETTINGS, PROTOCOL_VERSION, type RaceSettings } from "@fifth-copy/protocol";
import { DRAIN_POLL_MS } from "./app";
import { DRAIN_RETRY_AFTER_S } from "./http/internal";
import { internalHeaders } from "./http/sign";
import {
  boot,
  fixtureWebApi,
  HOST_SUB,
  SECRET,
  track,
  until,
  type Booted,
} from "./testing/harness";

// #704 C1: a SIGTERM drains the race server (Railway replaces it on deploy). Real Redis, fake clock
// and scheduler; recovery off (shared db), so these tests exercise the drain alone.

let b: Booted | undefined;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await b?.stop();
  b = undefined;
});

const timed: RaceSettings = { ...DEFAULT_RACE_SETTINGS, timerS: 60 };

/** A room with two seated members whose race reached GO (no sockets: the lifecycle alone). */
async function runningRace(booted: Booted, settings: RaceSettings) {
  const lobby = await booted.openRoom("DRN-0001", settings);
  await booted.server.registry.join(lobby, { userId: HOST_SUB, name: "Host" });
  await booted.server.registry.join(lobby, { userId: "usr_d1", name: "Dee" });
  const ack = await booted.server.lifecycle.start(lobby, { sub: HOST_SUB, role: "host" });
  expect(ack.ok).toBe(true);
  booted.clock.advance(3_000);
  await until(() => booted.server.desks.get(lobby)?.phase === "running", 3_000, "GO");
  return lobby;
}

/** Advances the fake clock in poll-sized steps, letting the async work of each step settle. */
async function advance(booted: Booted, ms: number) {
  for (let left = ms; left > 0; left -= DRAIN_POLL_MS) {
    booted.clock.advance(Math.min(DRAIN_POLL_MS, left));
    await new Promise((r) => setTimeout(r, 5));
  }
}

function openRoomRequest(booted: Booted) {
  const body = JSON.stringify({
    v: PROTOCOL_VERSION,
    lobbyId: booted.lobby(),
    code: "NEW-0001",
    hostUserId: HOST_SUB,
    settings: DEFAULT_RACE_SETTINGS,
  });
  return fetch(`${booted.url}/internal/rooms`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...internalHeaders({ rawBody: body, secret: SECRET, nowMs: booted.clock.now() }),
    },
    body,
  });
}

describe("drain on SIGTERM (#704 C1)", () => {
  it("reports draining on /health and refuses new rooms with a retryable 503", async () => {
    b = await boot(process.env.REDIS_URL);
    const before = await openRoomRequest(b);
    expect(before.status).toBe(200);
    expect(b.server.registry.count()).toBe(1);

    void b.server.drain(60_000);
    const health = await fetch(`${b.url}/health`);
    expect(health.status).toBe(503);
    expect(await health.json()).toMatchObject({ draining: true, ok: false });

    const refused = await openRoomRequest(b);
    expect(refused.status).toBe(503);
    expect(refused.headers.get("retry-after")).toBe(String(DRAIN_RETRY_AFTER_S));
    expect(await refused.json()).toEqual({ error: "draining" });
    // The refused room was never opened; the idle one (no race, no socket) no longer holds the drain.
    await until(() => b!.server.registry.count() === 0, 3_000, "idle room released");
  });

  it("keeps a running race ticking to its end, stores its results, then resolves empty", async () => {
    const web = fixtureWebApi({ now: () => Date.now() });
    b = await boot(process.env.REDIS_URL, { webApi: web.api });
    const lobby = await runningRace(b, timed);
    let outcome: string | undefined;
    void b.server.drain(15 * 60_000).then((o) => (outcome = o));

    await advance(b, 30_000);
    expect(outcome).toBeUndefined();
    expect(b.server.desks.get(lobby)?.phase).toBe("running");
    expect((await b.server.registry.room(lobby))?.phase).toBe("running");

    await advance(b, 31_000);
    await until(() => web.results.length > 0, 3_000, "results posted");
    expect(web.results[0]!.results.map((r) => r.desk).sort()).toEqual([1, 2]);
    await advance(b, 2 * DRAIN_POLL_MS);
    await until(() => outcome !== undefined, 3_000, "drained");
    expect(outcome).toBe("empty");
    expect(b.server.registry.count()).toBe(0);
    // The ended room stays in Redis for whoever serves it next; only this process let it go.
    expect((await b.server.registry.room(lobby))?.phase).toBe("ended");
  });

  it("resolves at the cap while a race still runs", async () => {
    b = await boot(process.env.REDIS_URL);
    const lobby = await runningRace(b, { ...DEFAULT_RACE_SETTINGS, timerS: null });
    let outcome: string | undefined;
    void b.server.drain(5_000).then((o) => (outcome = o));
    await advance(b, 4_000);
    expect(outcome).toBeUndefined();
    await advance(b, 2_000);
    await until(() => outcome !== undefined, 3_000, "capped");
    expect(outcome).toBe("cap");
    expect(b.server.desks.get(lobby)?.phase).toBe("running");
  });

  it("lets a waiting room with no socket go, and holds one whose member is connected", async () => {
    b = await boot(process.env.REDIS_URL);
    await b.openRoom("IDL-0001");
    const held = await b.openRoom("HLD-0001");
    const client = b.connect({
      v: PROTOCOL_VERSION,
      token: await b.token({ lobby: held, sub: HOST_SUB, role: "host" }),
    });
    const host = track(client);
    await until(() => !!host.welcome, 3_000, "welcome");
    let outcome: string | undefined;
    void b.server.drain(60_000).then((o) => (outcome = o));
    await advance(b, 2 * DRAIN_POLL_MS);
    await until(() => b!.server.registry.count() === 1, 3_000, "idle room released");
    expect(outcome).toBeUndefined();

    await b.server.registry.leave(held, HOST_SUB);
    client.disconnect();
    await advance(b, 2 * DRAIN_POLL_MS);
    await until(() => outcome !== undefined, 3_000, "drained");
    expect(outcome).toBe("empty");
  });
});
