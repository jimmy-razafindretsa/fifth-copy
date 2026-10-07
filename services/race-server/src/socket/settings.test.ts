import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RACE_SETTINGS,
  PROTOCOL_VERSION,
  type HostSettingsAck,
  type RaceSettings,
} from "@fifth-copy/protocol";
import { membersKey, roomKey } from "../rooms/keys";
import {
  boot,
  connectRedis,
  HOST_SUB,
  track,
  until,
  type Booted,
  type Client,
} from "../testing/harness";

// #101: host-only settings updates over the wire (ADR 0006 point 4, 0009; ARCHITECTURE 7.1, 7.2).
let t: Booted | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await t?.stop();
  t = undefined;
});

/** Sends `host:settings` with an ack; the payload is untyped so refusals can send anything. */
function send(client: Client, payload: unknown): Promise<HostSettingsAck> {
  return client.timeout(2_000).emitWithAck("host:settings", payload as never);
}

async function room() {
  t = await boot(process.env.REDIS_URL);
  const lobby = await t.openRoom();
  const host = t.connect({
    v: PROTOCOL_VERSION,
    token: await t.token({ lobby, sub: HOST_SUB, name: "Ada", role: "host" }),
  });
  const player = t.connect({
    v: PROTOCOL_VERSION,
    token: await t.token({ lobby, sub: "usr_player", name: "Bob" }),
  });
  const seenHost = track(host);
  const seenPlayer = track(player);
  await until(
    () => seenHost.roster?.length === 2 && seenPlayer.roster?.length === 2,
    2_000,
    "roster 2",
  );
  return { booted: t, lobby, host, player, seenHost, seenPlayer };
}

async function storedSettings(lobby: string): Promise<unknown> {
  const redis = await connectRedis(process.env.REDIS_URL);
  try {
    return JSON.parse((await redis.hget(roomKey(lobby), "settings")) ?? "null");
  } finally {
    redis.disconnect();
  }
}

const settle = () => new Promise((r) => setTimeout(r, 200));

describe("host:settings applied by the host (C1)", () => {
  it("acks the merged settings, broadcasts them to every member, stores them with TTLs", async () => {
    const { booted, lobby, host, seenHost, seenPlayer } = await room();
    const ack = await send(host, {
      v: PROTOCOL_VERSION,
      patch: { timerS: 120, errorMode: "block" },
    });
    const expected: RaceSettings = { ...DEFAULT_RACE_SETTINGS, timerS: 120, errorMode: "block" };
    expect(ack).toEqual({ ok: true, settings: expected });
    await until(
      () => seenHost.settings.length === 1 && seenPlayer.settings.length === 1,
      2_000,
      "settings broadcast",
    );
    expect(seenHost.settings).toEqual([expected]);
    expect(seenPlayer.settings).toEqual([expected]);
    expect(await storedSettings(lobby)).toEqual(expected);

    const redis = await connectRedis(process.env.REDIS_URL);
    try {
      for (const key of [roomKey(lobby), membersKey(lobby)])
        expect(await redis.ttl(key)).toBeGreaterThan(0);
    } finally {
      redis.disconnect();
    }

    const tab2 = track(
      booted.connect({
        v: PROTOCOL_VERSION,
        token: await booted.token({ lobby, sub: HOST_SUB, name: "Ada", role: "host" }),
      }),
    );
    await until(() => !!tab2.welcome, 2_000, "second tab welcome");
    expect(tab2.welcome?.settings).toEqual(expected);
  });

  it("logs the lobby, the outcome and the patched keys, never the values", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation(
      (...args: unknown[]) => void lines.push(args.map(String).join(" ")),
    );
    const { lobby, host } = await room();
    await send(host, { v: PROTOCOL_VERSION, patch: { practiceLetters: ["ж"], wordCount: 437 } });
    const line = lines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .find((l) => l.msg === "settings");
    expect(line).toEqual({
      level: "info",
      msg: "settings",
      lobby,
      outcome: "ok",
      keys: ["practiceLetters", "wordCount"],
    });
    for (const l of lines) {
      expect(l).not.toContain("ж");
      expect(l).not.toContain("437");
    }
  });
});

describe("host:settings refusals (C2)", () => {
  it("refuses a player's patch: not-host, nothing broadcast, hash unchanged", async () => {
    const { lobby, player, seenHost, seenPlayer } = await room();
    expect(await send(player, { v: PROTOCOL_VERSION, patch: { timerS: 120 } })).toEqual({
      ok: false,
      error: "not-host",
    });
    await settle();
    expect(seenHost.settings).toEqual([]);
    expect(seenPlayer.settings).toEqual([]);
    expect(await storedSettings(lobby)).toEqual(DEFAULT_RACE_SETTINGS);
  });

  it("refuses a token whose role is host but whose sub is not the room's host", async () => {
    const { booted, lobby, seenHost } = await room();
    const forged = booted.connect({
      v: PROTOCOL_VERSION,
      token: await booted.token({ lobby, sub: "usr_forger", role: "host" }),
    });
    const seen = track(forged);
    await until(() => !!seen.welcome, 2_000, "forger welcome");
    expect(await send(forged, { v: PROTOCOL_VERSION, patch: { timerS: 120 } })).toEqual({
      ok: false,
      error: "not-host",
    });
    await settle();
    expect(seenHost.settings).toEqual([]);
    expect(await storedSettings(lobby)).toEqual(DEFAULT_RACE_SETTINGS);
  });

  it.each([
    ["an out-of-range wordCount", { v: PROTOCOL_VERSION, patch: { wordCount: 9 } }],
    ["a lobbyType change", { v: PROTOCOL_VERSION, patch: { lobbyType: "public" } }],
    ["the previous protocol version", { v: PROTOCOL_VERSION - 1, patch: { timerS: 120 } }],
    ["an unknown key", { v: PROTOCOL_VERSION, patch: { nope: true } }],
    ["a non-object payload", "host"],
    ["a missing patch", { v: PROTOCOL_VERSION }],
  ])("refuses %s as invalid", async (_what, payload) => {
    const { lobby, host, seenPlayer } = await room();
    expect(await send(host, payload)).toEqual({ ok: false, error: "invalid" });
    await settle();
    expect(seenPlayer.settings).toEqual([]);
    expect(await storedSettings(lobby)).toEqual(DEFAULT_RACE_SETTINGS);
  });

  it("refuses once the room has left the waiting phase: not-waiting", async () => {
    const { lobby, host, seenPlayer } = await room();
    const redis = await connectRedis(process.env.REDIS_URL);
    try {
      await redis.hset(roomKey(lobby), "phase", "countdown");
    } finally {
      redis.disconnect();
    }
    expect(await send(host, { v: PROTOCOL_VERSION, patch: { timerS: 120 } })).toEqual({
      ok: false,
      error: "not-waiting",
    });
    await settle();
    expect(seenPlayer.settings).toEqual([]);
  });

  it("refuses when the room's keys were deleted after the join: no-room", async () => {
    const { lobby, host, seenPlayer } = await room();
    const redis = await connectRedis(process.env.REDIS_URL);
    try {
      await redis.del(roomKey(lobby), membersKey(lobby));
    } finally {
      redis.disconnect();
    }
    expect(await send(host, { v: PROTOCOL_VERSION, patch: { timerS: 120 } })).toEqual({
      ok: false,
      error: "no-room",
    });
    await settle();
    expect(seenPlayer.settings).toEqual([]);
  });

  it("tolerates a payload sent without an ack callback; the next call still acks", async () => {
    const { host, seenPlayer } = await room();
    host.emit("host:settings", { v: PROTOCOL_VERSION, patch: { wordCount: 9 } } as never);
    host.emit("host:settings", "garbage" as never);
    host.emit("host:settings", { v: PROTOCOL_VERSION, patch: { timerS: 60 } } as never);
    await until(() => seenPlayer.settings.length === 1, 2_000, "settings from the ackless call");
    expect(await send(host, { v: PROTOCOL_VERSION, patch: { timerS: 90 } })).toEqual({
      ok: true,
      settings: { ...DEFAULT_RACE_SETTINGS, timerS: 90 },
    });
  });
});
