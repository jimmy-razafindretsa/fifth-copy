import { randomUUID } from "node:crypto";
import type { Command, Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_RACE_SETTINGS, type RaceInfo } from "@fifth-copy/protocol";
import { createFakeClock } from "../clock";
import { connectRedis } from "../testing/harness";
import { createDesksState, playerStateOf } from "./desks-state";
import { desksKey, membersKey, ROOM_TTL_S, roomKey } from "./keys";
import { createRoomRegistry } from "./registry";

// #173: the desks' runtime and its Redis mirror (real Redis; deletes only its own keys).
let redis: Redis;
const lobbies: string[] = [];
beforeAll(async () => {
  redis = await connectRedis(process.env.REDIS_URL);
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  const keys = lobbies.flatMap((id) => [roomKey(id), membersKey(id), desksKey(id)]);
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
    expect(sent.map((c) => c[0])).toEqual(["multi", "hset", "expire", "exec"]);
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

  it("the registry deletes the desks hash with the room and refreshes its TTL with the room's", async () => {
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
    await registry.leave(id, "a");
    await registry.leave(id, "b");
    expect(await redis.exists(desksKey(id))).toBe(0);
  });
});
