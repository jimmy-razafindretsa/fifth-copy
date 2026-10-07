import { randomUUID } from "node:crypto";
import type { Command, Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_RACE_SETTINGS, type RaceInfo } from "@fifth-copy/protocol";
import { createFakeClock } from "../clock";
import { connectRedis } from "../testing/harness";
import { createDesksState, playerStateOf } from "./desks-state";
import { desksKey, membersKey, ROOM_TTL_S, roomKey, traceKey } from "./keys";
import { createRoomRegistry } from "./registry";

// #173: the desks' runtime and its Redis mirror (real Redis; deletes only its own keys).
let redis: Redis;
const lobbies: string[] = [];
beforeAll(async () => {
  redis = await connectRedis(process.env.REDIS_URL);
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  const keys = lobbies.flatMap((id) => [
    roomKey(id),
    membersKey(id),
    desksKey(id),
    ...[1, 2, 3, 4].map((desk) => traceKey(id, desk)),
  ]);
  if (keys.length) await redis.del(...keys);
  redis.disconnect();
});

const race: RaceInfo = {
  raceId: "6f1c2a4e-8b9d-4c3e-9f0a-1b2c3d4e5f60",
  text: "  Le  café ",
  language: "fr",
  wordCount: 2,
  t0: 5_000,
  timerS: null,
};
const deskList = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ desk: n - i, userId: `u${i}`, name: "D", isBot: false }));

function lobby() {
  const id = `lob_${randomUUID()}`;
  lobbies.push(id);
  return id;
}

/** Counts the EXEC calls and records the commands sent between MULTI and EXEC. */
function spyExec() {
  const sent: string[][] = [];
  const original = redis.sendCommand.bind(redis);
  vi.spyOn(redis, "sendCommand").mockImplementation((command: Command, ...rest) => {
    sent.push([command.name.toLowerCase(), ...command.args.map(String)]);
    return original(command, ...(rest as []));
  });
  return sent;
}

/** Every key a write in the transaction touched also gets `EXPIRE key ROOM_TTL_S` in it (ADR 0008). */
function expectEveryWriteHasTtl(sent: string[][]) {
  const written = new Set(
    sent.filter(([name]) => ["hset", "rpush", "del"].includes(name!)).map(([, key]) => key),
  );
  const expired = new Set(
    sent
      .filter(([name, , ttl]) => name === "expire" && ttl === String(ROOM_TTL_S))
      .map((c) => c[1]),
  );
  expect(written.size).toBeGreaterThan(0);
  for (const key of written) expect(expired, `TTL for ${key}`).toContain(key);
}

describe("desks state", () => {
  it("opens every desk at the initial state, sorted, with the normalised text", () => {
    const state = createDesksState({ redis });
    const id = lobby();
    const rt = state.open(id, { race, settings: DEFAULT_RACE_SETTINGS, desks: deskList(3) });
    expect(rt).toMatchObject({ t0: 5_000, text: "Le café", textLength: 7, phase: "running" });
    expect(rt.desks.map((d) => d.desk)).toEqual([1, 2, 3]);
    expect([...rt.dirty].sort()).toEqual([1, 2, 3]);
    expect(rt.states.get(2)).toMatchObject({
      cursor: 0,
      status: "typing",
      lastKeyAt: 5_000,
      trace: [],
    });
    expect(playerStateOf(rt.states.get(2)!)).not.toHaveProperty("trace");
  });

  it("flushes the dirty desks in one MULTI with the room TTL, then nothing when clean", async () => {
    const state = createDesksState({ redis });
    const id = lobby();
    state.open(id, { race, settings: DEFAULT_RACE_SETTINGS, desks: deskList(3) });
    const sent = spyExec();
    await state.flush(id);
    expect(sent.filter((c) => c[0] === "exec")).toHaveLength(1);
    expect(sent.slice(0, 3).map((c) => c[0])).toEqual(["multi", "hset", "expire"]);
    expect(sent[2]).toEqual(["expire", desksKey(id), String(ROOM_TTL_S)]);
    expect(Object.keys(await redis.hgetall(desksKey(id))).sort()).toEqual(["1", "2", "3"]);
    expect(await redis.ttl(desksKey(id))).toBeGreaterThan(0);

    await state.flush(id);
    expect(sent.filter((c) => c[0] === "exec")).toHaveLength(1);

    const desk2 = state.states(id).get(2)!;
    state.set(id, 2, { ...desk2, status: "asleep" });
    state.set(id, 99, desk2); // not in the race: ignored
    await state.flush(id);
    expect(sent.filter((c) => c[0] === "exec")).toHaveLength(2);
    expect(sent.find((c) => c[0] === "hset" && c[2] === "2" && c.length === 4)).toBeDefined();
    expect(JSON.parse((await redis.hget(desksKey(id), "2"))!)).toMatchObject({ status: "asleep" });
  });

  it("C2: the hash keeps the counters; each desk's trace is appended to its own list with the TTL", async () => {
    const state = createDesksState({ redis });
    const id = lobby();
    state.open(id, { race, settings: DEFAULT_RACE_SETTINGS, desks: deskList(2) });
    const desk1 = state.states(id).get(1)!;
    desk1.trace.push({ t: 10, key: "L" }, { t: 20, key: "e" });
    state.set(id, 1, { ...desk1, cursor: 2, correct: 2, total: 2, typed: ["L", "e"] });
    const sent = spyExec();
    await state.flush(id);

    const stored = JSON.parse((await redis.hget(desksKey(id), "1"))!) as Record<string, unknown>;
    expect(stored).toMatchObject({ cursor: 2, correct: 2, total: 2, status: "typing" });
    expect(stored).not.toHaveProperty("trace");
    expect(stored).not.toHaveProperty("typed");
    expect((await redis.lrange(traceKey(id, 1), 0, -1)).map((e) => JSON.parse(e))).toEqual([
      { t: 10, key: "L" },
      { t: 20, key: "e" },
    ]);
    expect(await redis.ttl(traceKey(id, 1))).toBeGreaterThan(0);
    expectEveryWriteHasTtl(sent);

    // Next tick: only the new keystroke goes out, appended.
    desk1.trace.push({ t: 30, key: " " });
    state.set(id, 1, { ...state.states(id).get(1)!, cursor: 3 });
    sent.length = 0;
    await state.flush(id);
    expect(sent.filter((c) => c[0] === "rpush")).toEqual([
      ["rpush", traceKey(id, 1), JSON.stringify({ t: 30, key: " " })],
    ]);
    expect(sent.filter((c) => c[0] === "del")).toEqual([]);
    expectEveryWriteHasTtl(sent);
    expect(await redis.llen(traceKey(id, 1))).toBe(3);

    // A replaced trace (set() with a new array) is rewritten whole.
    state.set(id, 1, { ...state.states(id).get(1)!, trace: [{ t: 5, key: "x" }] });
    sent.length = 0;
    await state.flush(id);
    expect(sent.filter((c) => c[0] === "del")).toEqual([["del", traceKey(id, 1)]]);
    expect(await redis.lrange(traceKey(id, 1), 0, -1)).toEqual([
      JSON.stringify({ t: 5, key: "x" }),
    ]);
    expectEveryWriteHasTtl(sent);
  });

  it("C2: a failed flush rewrites the desk's whole trace on the next one", async () => {
    const state = createDesksState({ redis });
    const id = lobby();
    state.open(id, { race, settings: DEFAULT_RACE_SETTINGS, desks: deskList(1) });
    const desk1 = state.states(id).get(1)!;
    desk1.trace.push({ t: 10, key: "L" });
    state.set(id, 1, desk1);
    await state.flush(id);
    desk1.trace.push({ t: 20, key: "e" });
    state.set(id, 1, desk1);
    const multi = redis.multi.bind(redis);
    vi.spyOn(redis, "multi").mockImplementationOnce(() => {
      const tx = multi();
      tx.exec = () => Promise.reject(new Error("boom"));
      return tx;
    });
    await expect(state.flush(id)).rejects.toThrow("boom");
    expect(state.get(id)!.dirty.has(1)).toBe(true);
    await state.flush(id);
    expect(await redis.lrange(traceKey(id, 1), 0, -1)).toEqual([
      JSON.stringify({ t: 10, key: "L" }),
      JSON.stringify({ t: 20, key: "e" }),
    ]);
  });

  it("C2: a new race in the same lobby starts every trace list empty, the old race's desks too", async () => {
    const state = createDesksState({ redis });
    const id = lobby();
    state.open(id, { race, settings: DEFAULT_RACE_SETTINGS, desks: deskList(3) });
    for (const desk of [1, 2, 3]) {
      const s = state.states(id).get(desk)!;
      s.trace.push({ t: 10, key: "L" });
      state.set(id, desk, s);
    }
    await state.flush(id);
    expect(await redis.llen(traceKey(id, 3))).toBe(1);
    state.end(id);
    state.release(id);

    state.open(id, { race, settings: DEFAULT_RACE_SETTINGS, desks: deskList(2) });
    const sent = spyExec();
    await state.flush(id);
    for (const desk of [1, 2, 3]) expect(await redis.exists(traceKey(id, desk))).toBe(0);
    expect(sent.filter((c) => c[0] === "exec")).toHaveLength(1);
    expectEveryWriteHasTtl(sent);
  });

  it("end keeps the states, release frees them, close forgets the room", () => {
    const state = createDesksState({ redis });
    const id = lobby();
    state.open(id, { race, settings: DEFAULT_RACE_SETTINGS, desks: deskList(2) });
    state.end(id);
    expect(state.get(id)?.phase).toBe("ended");
    expect(state.states(id).size).toBe(2);
    state.release(id);
    expect(state.get(id)?.phase).toBe("ended");
    expect(state.states(id).size).toBe(0);
    state.close(id);
    expect(state.get(id)).toBeUndefined();
  });

  it("C2: the registry deletes the desks hash and the trace lists with the room and refreshes its TTL with the room's", async () => {
    const registry = createRoomRegistry({ redis, clock: createFakeClock(0) });
    const id = lobby();
    await registry.open({
      lobbyId: id,
      code: "ABCD",
      hostUserId: "host",
      settings: DEFAULT_RACE_SETTINGS,
    });
    await registry.join(id, { userId: "a", name: "Ada" });
    await redis.hset(desksKey(id), "1", "{}");
    await registry.join(id, { userId: "b", name: "Bob" });
    expect(await redis.ttl(desksKey(id))).toBeGreaterThan(0);
    await registry.startRace(id, {
      race,
      endAt: 9_000,
      desks: deskList(2).map((d) => ({ ...d, userId: d.desk === 1 ? "a" : "b" })),
    });
    await redis.rpush(traceKey(id, 1), "{}");
    await redis.rpush(traceKey(id, 2), "{}");
    await registry.leave(id, "a");
    expect(await redis.exists(traceKey(id, 1))).toBe(1);
    await registry.leave(id, "b");
    expect(await redis.exists(desksKey(id))).toBe(0);
    expect(await redis.exists(traceKey(id, 1), traceKey(id, 2))).toBe(0);
  });
});
