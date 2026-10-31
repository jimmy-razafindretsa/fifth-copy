import { afterEach, describe, expect, it, vi } from "vitest";
import { keysSchema, pingSchema, PROTOCOL_VERSION, type Rejected } from "@fifth-copy/protocol";
import type { Limiter } from "@fifth-copy/limiter";
import { createFakeClock } from "../clock";
import { boot, HOST_SUB, startedRace, until, watchRace, type Booted } from "../testing/harness";
import {
  createSocketGuard,
  exceedsBytes,
  MAX_PAYLOAD_BYTES,
  MAX_SOCKETS_PER_USER,
  REFUSAL_WINDOW_MS,
  SOCKET_LIMITS,
  type GuardedSocket,
  type RateLimitDeps,
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

describe("one budget per token identity (real Redis)", () => {
  /** A waiting room and `n` sockets of one player token, each welcomed. */
  async function sameToken(n: number) {
    booted = await boot(process.env.REDIS_URL);
    const lobby = await booted.openRoom();
    // The host stays connected: the room outlives the player's reconnections.
    const host = booted.connect({
      v: PROTOCOL_VERSION,
      token: await booted.token({ lobby, sub: HOST_SUB, role: "host" }),
    });
    const hostSeen = watchRace(host);
    await until(() => !!hostSeen.welcome, undefined, "host welcomed");
    const token = await booted.token({ lobby, sub: "usr_tabs", role: "player" });
    const tabs = Array.from({ length: n }, () => {
      const client = booted!.connect({ v: PROTOCOL_VERSION, token });
      return { client, seen: watchRace(client) };
    });
    await until(() => tabs.every((t) => !!t.seen.welcome), undefined, "every tab welcomed");
    return { lobby, token, tabs };
  }
  const settingsCall = { v: PROTOCOL_VERSION, patch: { timerS: 90 } } as const;

  it(`${MAX_SOCKETS_PER_USER} sockets of one token share one host:settings budget; the excess never reaches the room queue`, async () => {
    const { tabs } = await sameToken(MAX_SOCKETS_PER_USER);
    const update = vi.spyOn(booted!.server.registry, "updateSettings");
    const acks: unknown[] = [];
    for (const { client } of tabs) {
      for (let i = 0; i < 2; i++) client.emit("host:settings", settingsCall, (a) => acks.push(a));
    }
    await until(
      () => tabs.every((t) => t.client.disconnected),
      undefined,
      "every tab of the flooding identity cut",
    );
    await settle();
    // 2 x 4 calls, one budget of 5: 5 reach the registry (and are refused `not-host`), 3 are refused.
    expect(update).toHaveBeenCalledTimes(SOCKET_LIMITS["host:settings"].max);
    expect(acks.length).toBeLessThanOrEqual(SOCKET_LIMITS["host:settings"].max);
    expect(tabs.flatMap((t) => t.seen.rejected)).toHaveLength(3);
  });

  it("a reconnection does not refill the bucket", async () => {
    const { tabs, token } = await sameToken(1);
    const acks: unknown[] = [];
    for (let i = 0; i < SOCKET_LIMITS["host:settings"].max; i++) {
      tabs[0]!.client.emit("host:settings", settingsCall, (a) => acks.push(a));
    }
    await until(() => acks.length === SOCKET_LIMITS["host:settings"].max, undefined, "5 acks");
    tabs[0]!.client.disconnect();
    const again = booted!.connect({ v: PROTOCOL_VERSION, token });
    const seen = watchRace(again);
    await until(() => !!seen.welcome, undefined, "reconnected");
    again.emit("host:settings", settingsCall, (a) => acks.push(a));
    await until(() => seen.rejected.length === 1, undefined, "refused after the reconnection");
    await settle();
    expect(acks).toHaveLength(SOCKET_LIMITS["host:settings"].max);
    expect(seen.rejected[0]!.reason).toBe("rate-limit");
  });

  it(`the socket past ${MAX_SOCKETS_PER_USER} of one token is refused and closed; the others stay seated`, async () => {
    const { tabs, token } = await sameToken(MAX_SOCKETS_PER_USER);
    const extra = booted!.connect({ v: PROTOCOL_VERSION, token });
    const seen = watchRace(extra);
    await until(() => extra.disconnected && seen.rejected.length === 1, undefined, "extra refused");
    expect(seen.rejected[0]!.reason).toBe("rate-limit");
    expect(seen.welcome).toBeUndefined();
    await settle();
    expect(tabs.every((t) => t.client.connected)).toBe(true);
    // A second-tab handoff still works: one tab closes, a new one is welcomed at the same desk.
    tabs[0]!.client.disconnect();
    await settle();
    const handoff = booted!.connect({ v: PROTOCOL_VERSION, token });
    const handoffSeen = watchRace(handoff);
    await until(() => !!handoffSeen.welcome, undefined, "handoff welcomed");
    expect(handoffSeen.welcome!.you).toBe(tabs[1]!.seen.welcome!.you);
  });
});

/** A fake socket around the guard: `next` records the events that reached the handlers. */
function fakeSocket(id = "sock_1") {
  let middleware: ((packet: unknown[], next: (err?: Error) => void) => void) | undefined;
  let onDisconnect: (() => void) | undefined;
  const emitted: unknown[] = [];
  const passed: string[] = [];
  const socket: GuardedSocket & { cut: boolean } = {
    id,
    cut: false,
    get disconnected() {
      return this.cut;
    },
    use: (fn) => (middleware = fn),
    emit: (_e, payload) => emitted.push(payload),
    disconnect() {
      if (this.cut) return;
      this.cut = true;
      onDisconnect?.();
    },
    once: (_e, fn) => (onDisconnect = fn),
  };
  const send = (...packet: unknown[]) =>
    middleware!(packet, () => void passed.push(String(packet[0])));
  return { socket, emitted, passed, send };
}

const allow = () =>
  vi.fn<Limiter["limit"]>(async () => ({ ok: true, remaining: 1, retryAfterMs: 0 }));
const guardOf = (limit: Limiter["limit"], extra: Partial<RateLimitDeps> = {}) =>
  createSocketGuard({ limiter: { limit }, clock: createFakeClock(0), log: () => {}, ...extra });
const ID = { lobby: "lob_1", sub: "usr_1", role: "player" };
const oversized = "x".repeat(MAX_PAYLOAD_BYTES + 1);

describe("createSocketGuard (unit)", () => {
  it("fails closed: a message Redis cannot count is dropped, logged once, never counted as a refusal", async () => {
    const limiter: Limiter = { limit: () => Promise.reject(new Error("ECONNREFUSED")) };
    const lines: unknown[] = [];
    const { socket, emitted, passed, send } = fakeSocket();
    createSocketGuard({
      limiter,
      clock: createFakeClock(0),
      log: (msg: string, fields: Record<string, unknown>) => lines.push({ msg, ...fields }),
    }).admit(socket, ID);
    for (let i = 0; i < 5; i++) send("keys", { v: PROTOCOL_VERSION, batch: [] });
    await settle();
    expect(passed).toEqual([]);
    expect(emitted).toEqual([]);
    expect(socket.disconnected).toBe(false);
    expect(lines).toEqual([{ msg: "rate-limit unavailable", socket: "sock_1", lobby: "lob_1" }]);
  });

  it("lets unknown and prototype event names through to Socket.IO (no handler) under the payload cap only", async () => {
    const limit = allow();
    const { socket, passed, emitted, send } = fakeSocket();
    guardOf(limit).admit(socket, ID);
    send("constructor", {});
    send("__proto__", {});
    send("nope", oversized);
    await settle();
    expect(passed).toEqual(["constructor", "__proto__"]);
    expect(emitted).toEqual([{ v: PROTOCOL_VERSION, reason: "rate-limit" }]);
    expect(limit).not.toHaveBeenCalled();
  });

  it("keys the shared bucket on the token identity, never on the socket id", async () => {
    const limit = allow();
    const guard = guardOf(limit);
    const a = fakeSocket("sock_a");
    const b = fakeSocket("sock_b");
    guard.admit(a.socket, ID);
    guard.admit(b.socket, ID);
    a.send("ping", { v: PROTOCOL_VERSION, sent: 1 });
    b.send("ping", { v: PROTOCOL_VERSION, sent: 2 });
    await settle();
    const keys = limit.mock.calls.map(([key]) => key);
    expect(keys).toEqual(["lob_1:seat:usr_1:ping", "lob_1:seat:usr_1:ping"]);
    expect(keys.join()).not.toContain("sock_");
  });

  it("a burst past the bucket is refused locally: Redis counts at most `max` calls of the window", async () => {
    const limit = allow();
    const { socket, passed, emitted, send } = fakeSocket();
    guardOf(limit).admit(socket, ID);
    for (let i = 0; i < 40; i++) send("keys", { v: PROTOCOL_VERSION, batch: [] });
    await settle();
    expect(limit).toHaveBeenCalledTimes(SOCKET_LIMITS.keys.max);
    // The admitted batches still reach their handlers; the 3 local refusals cut the socket after.
    expect(passed).toHaveLength(SOCKET_LIMITS.keys.max);
    expect(emitted).toHaveLength(3);
    expect(socket.disconnected).toBe(true);
  });

  it("once a socket is cut, its later messages never touch Redis or the size walk", async () => {
    const limit = allow();
    const { socket, passed, send } = fakeSocket();
    guardOf(limit).admit(socket, ID);
    for (let i = 0; i < 3; i++) send("ping", oversized);
    // Still open until the next tick: a pipelined burst arrives meanwhile.
    for (let i = 0; i < 100; i++) send("keys", { v: PROTOCOL_VERSION, batch: [] });
    await settle();
    expect(limit).not.toHaveBeenCalled();
    expect(passed).toEqual([]);
    expect(socket.disconnected).toBe(true);
  });

  it("refusals of one identity add up across its sockets and survive a reconnection", async () => {
    const limit = allow();
    const lines: unknown[] = [];
    const guard = guardOf(limit, { log: (msg, f) => lines.push({ msg, ...f }) });
    const a = fakeSocket("sock_a");
    const b = fakeSocket("sock_b");
    guard.admit(a.socket, ID);
    guard.admit(b.socket, ID);
    a.send("ping", oversized);
    a.socket.disconnect(true); // reconnection: a fresh socket of the same identity
    const c = fakeSocket("sock_c");
    guard.admit(c.socket, ID);
    b.send("ping", oversized);
    expect(b.socket.disconnected).toBe(false);
    c.send("ping", oversized);
    await settle();
    // The 3rd refusal of the identity cuts every socket it holds.
    expect(b.socket.disconnected).toBe(true);
    expect(c.socket.disconnected).toBe(true);
    expect(lines).toEqual([
      { msg: "rate-limit disconnect", socket: "sock_c", lobby: "lob_1", count: 3 },
    ]);
  });

  it("a spectator token is its own identity: it never spends the seat's budget", async () => {
    const limit = allow();
    const guard = guardOf(limit);
    const seat = fakeSocket("sock_seat");
    const projector = fakeSocket("sock_projector");
    guard.admit(seat.socket, { ...ID, role: "host" });
    guard.admit(projector.socket, { ...ID, role: "spectator" });
    seat.send("ping", { v: PROTOCOL_VERSION, sent: 1 });
    projector.send("ping", { v: PROTOCOL_VERSION, sent: 1 });
    await settle();
    expect(limit.mock.calls.map(([key]) => key)).toEqual([
      "lob_1:seat:usr_1:ping",
      "lob_1:spectator:usr_1:ping",
    ]);
  });

  it(`refuses the identity's socket past ${MAX_SOCKETS_PER_USER}; a slot frees when one closes`, () => {
    const guard = guardOf(allow());
    const open = Array.from({ length: MAX_SOCKETS_PER_USER }, (_, i) => fakeSocket(`sock_${i}`));
    for (const s of open) expect(guard.admit(s.socket, ID)).toBe(true);
    const extra = fakeSocket("sock_extra");
    expect(guard.admit(extra.socket, ID)).toBe(false);
    expect(extra.emitted).toEqual([{ v: PROTOCOL_VERSION, reason: "rate-limit" }]);
    expect(extra.socket.disconnected).toBe(true);
    // Another user of the room is not affected.
    expect(guard.admit(fakeSocket("sock_other").socket, { ...ID, sub: "usr_2" })).toBe(true);
    open[0]!.socket.disconnect(true);
    expect(guard.admit(fakeSocket("sock_again").socket, ID)).toBe(true);
  });

  it("forgets an identity once its sockets are closed and its refusals are older than the window", async () => {
    const clock = createFakeClock(0);
    const guard = guardOf(allow(), { clock });
    const a = fakeSocket();
    guard.admit(a.socket, ID);
    a.send("ping", oversized);
    a.socket.disconnect(true);
    // A refusal in the window is remembered after the socket closed.
    expect(guard.size()).toBe(1);
    clock.advance(REFUSAL_WINDOW_MS + 1);
    const b = fakeSocket("sock_b");
    guard.admit(b.socket, ID);
    b.socket.disconnect(true);
    expect(guard.size()).toBe(0);
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
