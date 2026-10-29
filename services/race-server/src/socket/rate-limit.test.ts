import { afterEach, describe, expect, it, vi } from "vitest";
import { keysSchema, pingSchema, PROTOCOL_VERSION, type Rejected } from "@fifth-copy/protocol";
import type { Limiter } from "@fifth-copy/limiter";
import { createFakeClock } from "../clock";
import { startedRace, until, type Booted } from "../testing/harness";
import {
  attachRateLimit,
  exceedsBytes,
  MAX_PAYLOAD_BYTES,
  SOCKET_LIMITS,
  type GuardedSocket,
} from "./rate-limit";

// #207 C2: per-socket rate limits and the payload cap on the race server's client events, over
// real Redis (the worktree's REDIS_URL) and the harness's fake clock.

let booted: Booted | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await booted?.stop();
  booted = undefined;
});

const TEXT = "abcdefghijklmnopqrstuvwxyzabcdefghij"; // 36 characters: room for 30 one-key batches.
const settle = () => new Promise((r) => setTimeout(r, 200));

/** Log lines the server printed (JSON on console.log) with this `msg`. */
function logLines(spy: { mock: { calls: unknown[][] } }, msg: string) {
  return spy.mock.calls
    .map(([line]) => {
      try {
        return JSON.parse(String(line)) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((l) => l?.msg === msg);
}

describe("race server rate limits (C2, real Redis)", () => {
  it("30 keys batches in one fake second: the excess is rejected, the desk counts only the accepted ones, the socket is cut", async () => {
    const log = vi.spyOn(console, "log");
    const race = await startedRace(process.env.REDIS_URL, { players: 2, text: TEXT });
    booted = race.booted;
    const [, typist] = race.racers;
    let disconnected = false;
    typist!.client.on("disconnect", () => (disconnected = true));

    for (let i = 0; i < 30; i++) {
      typist!.client.emit("keys", { v: PROTOCOL_VERSION, batch: [{ t: i, key: TEXT[i]! }] });
    }
    await until(() => disconnected, undefined, "flooding socket disconnected");
    await settle();

    const rejected = typist!.seen.rejected;
    expect(rejected.length).toBeGreaterThanOrEqual(1);
    expect(rejected.length).toBeLessThanOrEqual(3);
    expect(rejected.every((r: Rejected) => r.reason === "rate-limit")).toBe(true);
    // Exactly the bucket's 25 batches reached the engine, in order.
    const state = race.booted.server.desks.states(race.lobby).get(typist!.desk)!;
    expect(state.cursor).toBe(SOCKET_LIMITS.keys.max);
    expect(state.correct).toBe(SOCKET_LIMITS.keys.max);
    // One log line for the cut: socket id, lobby and count, never the payload.
    const cuts = logLines(log, "rate-limit disconnect");
    expect(cuts).toHaveLength(1);
    expect(Object.keys(cuts[0]!).sort()).toEqual(["count", "level", "lobby", "msg", "socket"]);
    expect(cuts[0]).toMatchObject({ lobby: race.lobby, count: 3 });
  });

  it("allows the bucket again a fake second later", async () => {
    const race = await startedRace(process.env.REDIS_URL, { players: 2, text: TEXT });
    booted = race.booted;
    const [, typist] = race.racers;
    for (let i = 0; i < 26; i++) {
      typist!.client.emit("keys", { v: PROTOCOL_VERSION, batch: [{ t: i, key: TEXT[i]! }] });
    }
    await until(() => typist!.seen.rejected.length === 1, undefined, "one refusal");
    race.booted.clock.advance(1_000);
    for (let i = 25; i < 30; i++) {
      typist!.client.emit("keys", {
        v: PROTOCOL_VERSION,
        batch: [{ t: 1_000 + i, key: TEXT[i]! }],
      });
    }
    const desk = () => race.booted.server.desks.states(race.lobby).get(typist!.desk)!;
    await until(() => desk().cursor === 30, undefined, "five more batches accepted");
    expect(typist!.client.connected).toBe(true);
    expect(typist!.seen.rejected).toHaveLength(1);
  });

  it("refuses a 5 kB keys payload before parsing it", async () => {
    const race = await startedRace(process.env.REDIS_URL, { players: 2, text: TEXT });
    booted = race.booted;
    const [, typist] = race.racers;
    const parse = vi.spyOn(keysSchema, "safeParse");
    const big = { v: PROTOCOL_VERSION, batch: [{ t: 0, key: "a" }], pad: "x".repeat(5 * 1024) };
    typist!.client.emit("keys", big as never);
    await until(() => typist!.seen.rejected.length === 1, undefined, "payload refused");
    await settle();
    expect(typist!.seen.rejected[0]!.reason).toBe("rate-limit");
    expect(parse).not.toHaveBeenCalled();
    expect(race.booted.server.desks.states(race.lobby).get(typist!.desk)!.cursor).toBe(0);
    // One refusal does not cut the socket; a normal batch still lands.
    expect(typist!.client.connected).toBe(true);
    typist!.client.emit("keys", { v: PROTOCOL_VERSION, batch: [{ t: 1, key: "a" }] });
    await until(
      () => race.booted.server.desks.states(race.lobby).get(typist!.desk)!.cursor === 1,
      undefined,
      "batch after the refusal",
    );
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("disconnects a socket refused 3 times within 10 s; /health still answers", async () => {
    const log = vi.spyOn(console, "log");
    const race = await startedRace(process.env.REDIS_URL, { players: 2, text: TEXT });
    booted = race.booted;
    const [, typist] = race.racers;
    const parse = vi.spyOn(pingSchema, "safeParse");
    let disconnected = false;
    typist!.client.on("disconnect", () => (disconnected = true));
    // 2 pings a second are allowed: the 3rd, 4th and 5th are refusals.
    for (let i = 0; i < 5; i++) typist!.client.emit("ping", { v: PROTOCOL_VERSION, sent: i });
    await until(() => disconnected, undefined, "cut after 3 refusals");
    expect(parse).toHaveBeenCalledTimes(2);
    expect(logLines(log, "rate-limit disconnect")).toHaveLength(1);

    const health = await fetch(`${race.booted.url}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, service: "race-server" });
    // The other racer is still seated and connected.
    expect(race.racers[0]!.client.connected).toBe(true);
  });

  it("refusals spread over more than 10 s never cut the socket", async () => {
    const race = await startedRace(process.env.REDIS_URL, { players: 2, text: TEXT });
    booted = race.booted;
    const [, typist] = race.racers;
    const big = { v: PROTOCOL_VERSION, sent: 1, pad: "x".repeat(MAX_PAYLOAD_BYTES) };
    for (let round = 1; round <= 4; round++) {
      typist!.client.emit("ping", big as never);
      await until(() => typist!.seen.rejected.length === round, undefined, `refusal ${round}`);
      race.booted.clock.advance(5_001);
    }
    await settle();
    expect(typist!.client.connected).toBe(true);
  });
});

/** A fake socket around the guard: `next` records the events that reached the handlers. */
function fakeSocket() {
  let middleware: ((packet: unknown[], next: (err?: Error) => void) => void) | undefined;
  const emitted: unknown[] = [];
  const passed: string[] = [];
  const socket: GuardedSocket & { cut: boolean } = {
    id: "sock_1",
    cut: false,
    get disconnected() {
      return this.cut;
    },
    use: (fn) => (middleware = fn),
    emit: (_e, payload) => emitted.push(payload),
    disconnect() {
      this.cut = true;
    },
  };
  const send = (...packet: unknown[]) =>
    middleware!(packet, () => void passed.push(String(packet[0])));
  return { socket, emitted, passed, send };
}

describe("attachRateLimit (unit)", () => {
  it("fails closed: a message Redis cannot count is dropped, logged once, never counted as a refusal", async () => {
    const limiter: Limiter = { limit: () => Promise.reject(new Error("ECONNREFUSED")) };
    const lines: unknown[] = [];
    const { socket, emitted, passed, send } = fakeSocket();
    attachRateLimit(socket, "lob_1", {
      limiter,
      clock: createFakeClock(0),
      log: (msg, fields) => lines.push({ msg, ...fields }),
    });
    for (let i = 0; i < 5; i++) send("keys", { v: PROTOCOL_VERSION, batch: [] });
    await settle();
    expect(passed).toEqual([]);
    expect(emitted).toEqual([]);
    expect(socket.disconnected).toBe(false);
    expect(lines).toEqual([{ msg: "rate-limit unavailable", socket: "sock_1", lobby: "lob_1" }]);
  });

  it("lets unknown and prototype event names through to Socket.IO (no handler) under the payload cap only", async () => {
    const limit = vi.fn<Limiter["limit"]>(async () => ({
      ok: true,
      remaining: 1,
      retryAfterMs: 0,
    }));
    const { socket, passed, emitted, send } = fakeSocket();
    attachRateLimit(socket, "lob_1", {
      limiter: { limit },
      clock: createFakeClock(0),
      log: () => {},
    });
    send("constructor", {});
    send("__proto__", {});
    send("nope", "x".repeat(MAX_PAYLOAD_BYTES + 1));
    await settle();
    expect(passed).toEqual(["constructor", "__proto__"]);
    expect(emitted).toEqual([{ v: PROTOCOL_VERSION, reason: "rate-limit" }]);
    expect(limit).not.toHaveBeenCalled();
  });
});

describe("exceedsBytes", () => {
  it.each([
    [
      { v: 7, batch: Array.from({ length: 64 }, (_, t) => ({ t: 3_600_000 - t, key: "é" })) },
      false,
    ],
    ["x".repeat(MAX_PAYLOAD_BYTES), true],
    ["é".repeat(MAX_PAYLOAD_BYTES / 2), true],
    [Array.from({ length: 5_000 }, () => 0), true],
    [new Uint8Array(MAX_PAYLOAD_BYTES + 1), true],
    [{ a: () => "x".repeat(10_000) }, false],
  ])("%# -> %s", (value, expected) => {
    expect(exceedsBytes([value])).toBe(expected);
  });

  it("agrees with JSON.stringify on plain payloads within 10 %", () => {
    const payload = { v: 7, batch: Array.from({ length: 64 }, (_, t) => ({ t, key: "a" })) };
    const json = Buffer.byteLength(JSON.stringify([payload]));
    expect(exceedsBytes([payload], Math.ceil(json * 1.1))).toBe(false);
    expect(exceedsBytes([payload], Math.floor(json * 0.9))).toBe(true);
  });

  it("stops early on a deeply nested payload", () => {
    let deep: unknown = 0;
    for (let i = 0; i < 100_000; i++) deep = [deep];
    expect(exceedsBytes([deep])).toBe(true);
  });
});
